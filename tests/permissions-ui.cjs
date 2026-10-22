const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
async function main() {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "test-results", "macos-permissions-mocked");
  await fs.mkdir(output, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(
      root,
      ".frame-test-data",
      "permissions-" + Date.now(),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.FRAME_EXECUTABLE ? [] : [root],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .waitFor();
    const nativeInfo = await page.evaluate(() => window.frame.info());
    await app.evaluate(({ ipcMain }, info) => {
      global.mockPermissionState = {
        screen: "not-determined",
        microphone: "not-determined",
      };
      global.mockPermissionRequests = [];
      global.mockSettingsRequests = [];
      ipcMain.removeHandler("app:info");
      ipcMain.handle("app:info", () => ({
        ...info,
        platform: "darwin",
        screenPermission: global.mockPermissionState.screen,
        microphonePermission: global.mockPermissionState.microphone,
      }));
      ipcMain.removeHandler("app:request-permission");
      ipcMain.handle("app:request-permission", (_event, kind) => {
        global.mockPermissionRequests.push(kind);
        global.mockPermissionState[kind] =
          kind === "screen" ? "denied" : "granted";
        return global.mockPermissionState;
      });
      ipcMain.removeHandler("app:permissions");
      ipcMain.handle("app:permissions", (_event, kind) => {
        global.mockSettingsRequests.push(kind);
        return true;
      });
    }, nativeInfo);
    await page.reload();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "macOS permissions", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("switch", { name: "Use Win+Shift+S for Frame" })
        .count(),
      0,
    );
    const screen = page.locator(".setting-row").filter({
      has: page.getByRole("heading", {
        name: "Screen Recording",
        exact: true,
      }),
    });
    const microphone = page
      .locator(".setting-row")
      .filter({
        has: page.getByRole("heading", { name: "Microphone", exact: true }),
      })
      .filter({ has: page.getByText(/Access:/) });
    await screen
      .getByRole("button", { name: "Request access", exact: true })
      .click();
    await screen.getByText("Access: denied.", { exact: false }).waitFor();
    await screen
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    assert.deepEqual(await app.evaluate(() => global.mockSettingsRequests), [
      "screen",
    ]);
    await microphone
      .getByRole("button", { name: "Request access", exact: true })
      .click();
    await microphone.getByText("Access: granted.", { exact: false }).waitFor();
    assert.deepEqual(await app.evaluate(() => global.mockPermissionRequests), [
      "screen",
      "microphone",
    ]);
    await app.evaluate(() => {
      global.mockPermissionState.screen = "granted";
    });
    await page
      .getByRole("button", { name: "Check permissions", exact: true })
      .click();
    await screen.getByText("Access: granted.", { exact: false }).waitFor();
    assert.match(
      await page
        .locator(".shortcut-setting")
        .filter({ hasText: "Capture screen" })
        .innerText(),
      /⌘ \+ Shift \+ 1/,
    );
    await page.screenshot({
      path: path.join(output, "preferences.png"),
      fullPage: true,
    });
    console.log(
      "PASS mocked macOS permission UI: prompt actions, denied settings link, microphone grant, status refresh, platform-only controls, and nonconflicting shortcut label",
    );
    console.log(
      "This tests UI logic on the host OS; it does not verify native macOS TCC dialogs.",
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
