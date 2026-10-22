const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results", "windows-shortcut");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let n = 0; n < 100; n++) {
    if (await check()) return;
    await wait(50);
  }
  throw new Error(message);
}
async function setToggle(toggle, enabled) {
  await toggle.setChecked(enabled);
  await until(
    () => toggle.isEnabled(),
    "shortcut preference did not finish saving",
  );
}
async function main() {
  if (process.platform !== "win32") {
    console.log("SKIP Windows-only shortcut test");
    return;
  }
  await fs.mkdir(output, { recursive: true });
  const probePath = path.join(output, "ShortcutProbe.exe");
  const compiler = path.join(
    process.env.SystemRoot,
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  execFileSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      "/out:" + probePath,
      path.join(__dirname, "windows-shortcut-probe.cs"),
    ],
    { windowsHide: true },
  );
  const probe = spawn(probePath, [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const events = [];
  let buffer = "";
  probe.stdout.on("data", (chunk) => {
    buffer += chunk;
    let n;
    while ((n = buffer.indexOf("\n")) >= 0) {
      events.push(buffer.slice(0, n).trim());
      buffer = buffer.slice(n + 1);
    }
  });
  await until(() => events.includes("READY"), "probe did not start");
  const dataDir = path.join(root, ".frame-test-data", "shortcut-" + Date.now());
  const env = { ...process.env, FRAME_TEST: "1", FRAME_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    args: process.env.FRAME_EXECUTABLE ? [] : [root],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  };
  let app;
  async function send(variant) {
    const before = events.filter((x) => x === "SENT").length;
    probe.stdin.write(variant + "\n");
    await until(
      () => events.filter((x) => x === "SENT").length > before,
      "input injection failed",
    );
    await wait(150);
  }
  async function preferences(page) {
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    return page.getByRole("switch", {
      name: "Use Win+Shift+S for Frame",
      exact: true,
    });
  }
  try {
    app = await electron.launch(options);
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor();
    let toggle = await preferences(page);
    assert.equal(await toggle.isChecked(), false);
    await setToggle(toggle, true);
    await until(
      async () =>
        (await page.evaluate(() => window.frame.info())).snippingShortcut
          .active,
      "Frame shortcut not active",
    );
    await page.screenshot({ path: path.join(output, "preferences.png") });
    assert.equal(
      (await page.evaluate(() => window.frame.info())).snippingShortcut.error,
      "",
    );
    await app.evaluate(async ({ BrowserWindow, screen }) => {
      const display = screen.getPrimaryDisplay();
      const fixture = new BrowserWindow({
        ...display.bounds,
        frame: false,
        fullscreen: true,
        alwaysOnTop: true,
        backgroundColor: "#e8efe5",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await fixture.loadURL(
        "data:text/html," +
          encodeURIComponent(
            '<html><body style="margin:0;background:#e8efe5;width:100%;height:100dvh"><h1>Frame shortcut fixture</h1></body></html>',
          ),
      );
      fixture.show();
      global.shortcutFixture = fixture;
    });
    const fixturePage = app.windows().find((p) => p.url().startsWith("data:"));
    await fixturePage.mouse.move(350, 350);
    await wait(250);
    const passedBefore = events.filter(
      (x) => x === "S_DOWN" || x === "S_UP",
    ).length;
    // Repeated S keydown must create only one area overlay.
    const overlayPromise = app.waitForEvent("window");
    await send(1);
    let overlay = await overlayPromise;
    await overlay.locator("#screen").waitFor();
    assert.equal(
      await overlay.evaluate(() => document.hasFocus()),
      true,
      "Start must not steal focus after Win is released",
    );
    assert.equal(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length,
      passedBefore,
      "Win+Shift+S must not reach the next hook / Windows Snipping Tool",
    );
    await overlay.keyboard.press("Escape").catch((error) => {
      if (!error.message.includes("closed")) throw error;
    });
    await until(
      async () =>
        !(await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (w) => w.getTitle() === "Select capture area",
          ),
        )),
      "cancelled overlay did not close",
    );
    assert.equal((await page.evaluate(() => window.frame.list())).length, 0);
    console.log(
      "PASS native Win+Shift+S overrides the Windows hook chain, suppresses repeats, opens area selection directly, and cancels with Escape",
    );
    await app.evaluate(() => global.shortcutFixture.focus());
    const secondOverlay = app.waitForEvent("window");
    await send(2);
    overlay = await secondOverlay;
    await overlay.locator("#screen").waitFor();
    await overlay.mouse.move(80, 100);
    await overlay.mouse.down();
    await overlay.mouse.move(330, 280, { steps: 8 });
    await overlay.mouse.up();
    await page.getByLabel("Image annotation canvas").waitFor();
    const captures = await page.evaluate(() => window.frame.list());
    assert.equal(captures.length, 1);
    assert(captures[0].width >= 240 && captures[0].height >= 170);
    assert.equal(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length,
      passedBefore,
    );
    console.log(
      "PASS right Win/right Shift, cursor-display capture, native crop, saved image, and editor",
    );
    await page
      .getByRole("button", { name: "Back to library", exact: true })
      .click();
    toggle = await preferences(page);
    await send(3);
    await send(4);
    assert.equal(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length,
      passedBefore + 4,
      "plain S and Ctrl+Shift+S must pass through Frame",
    );
    await setToggle(toggle, false);
    await until(
      async () =>
        !(await page.evaluate(() => window.frame.info())).snippingShortcut
          .active,
      "hook did not stop",
    );
    const count = events.filter((x) => x === "S_DOWN" || x === "S_UP").length;
    await send(1);
    assert(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length > count,
      "disabling must restore propagation to the Windows hook chain",
    );
    await setToggle(toggle, true);
    await until(
      async () =>
        (await page.evaluate(() => window.frame.info())).snippingShortcut
          .active,
      "re-enable failed",
    );
    await app.close();
    app = null;
    const afterExit = events.filter(
      (x) => x === "S_DOWN" || x === "S_UP",
    ).length;
    await send(1);
    assert(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length > afterExit,
      "quitting Frame must remove the hook",
    );
    app = await electron.launch(options);
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .waitFor();
    toggle = await preferences(page);
    assert.equal(await toggle.isChecked(), true);
    await until(
      async () =>
        (await page.evaluate(() => window.frame.info())).snippingShortcut
          .active,
      "enabled preference did not survive restart",
    );
    const beforeCrash = events.filter(
      (x) => x === "S_DOWN" || x === "S_UP",
    ).length;
    const launcher = app.process();
    const main = await app.evaluate(() => ({
      pid: process.pid,
      type: process.type,
      test: process.env.FRAME_TEST,
    }));
    assert.equal(main.type, "browser");
    assert.equal(main.test, "1");
    assert.notEqual(main.pid, process.pid, "never terminate the test runner");
    const launcherExited = new Promise((resolve) =>
      launcher.once("exit", resolve),
    );
    // Electron/Playwright may use a launcher process; terminate the actual main.
    process.kill(main.pid);
    await Promise.race([launcherExited, wait(1000)]);
    await app.close().catch(() => {});
    app = null;
    await wait(200);
    await send(1);
    assert(
      events.filter((x) => x === "S_DOWN" || x === "S_UP").length > beforeCrash,
      "an unexpected Electron exit must close the helper's pipe and release the chord",
    );
    app = await electron.launch(options);
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .waitFor();
    toggle = await preferences(page);
    await until(
      async () =>
        (await page.evaluate(() => window.frame.info())).snippingShortcut
          .active,
      "shortcut did not restart after parent crash",
    );
    await setToggle(toggle, false);
    await app.close();
    app = null;
    app = await electron.launch(options);
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .waitFor();
    toggle = await preferences(page);
    assert.equal(await toggle.isChecked(), false);
    assert.equal(
      (await page.evaluate(() => window.frame.info())).snippingShortcut.active,
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS unrelated keys, disable, re-enable, quit/crash cleanup, and enabled/disabled preference persistence",
    );
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        { version: require("../package.json").version, passed: true, events },
        null,
        2,
      ),
    );
  } finally {
    if (app) await app.close();
    probe.stdin.end();
    await Promise.race([
      new Promise((resolve) => probe.once("exit", resolve)),
      wait(1500).then(() => probe.kill()),
    ]);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
