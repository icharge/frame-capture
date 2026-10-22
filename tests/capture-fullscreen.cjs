const { _electron: electron, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { nativeMouse } = require("./native-mouse.cjs");
async function main() {
  const root = path.resolve(__dirname, "..");
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(
      root,
      ".frame-test-data",
      "capture-fullscreen-" + Date.now(),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.FRAME_EXECUTABLE
      ? ["--background"]
      : [root, "--background"],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("heading", { name: /^Captures/ }).waitFor();
    const state = () =>
      app.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes("index.html"),
        );
        return {
          visible: main.isVisible(),
          fullscreen: main.isFullScreen(),
          selectors: BrowserWindow.getAllWindows().filter(
            (w) => w.getTitle() === "Select capture area",
          ).length,
          tray: !global.frameWorkflow.tray.isDestroyed(),
        };
      });
    const display = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      global.captureFixture = new BrowserWindow({
        ...d.bounds,
        frame: false,
        backgroundColor: "#e8efe5",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      global.captureFixture.setMenu(null);
      global.captureFixture.setAlwaysOnTop(true);
      await global.captureFixture.loadURL(
        "data:text/html,<body style='margin:0;background:%23e8efe5;height:100vh'><h1>Frame full-screen fixture</h1>",
      );
      return { id: String(d.id), bounds: d.bounds, scale: d.scaleFactor };
    });
    // Establish real foreground input, as a user does before invoking capture.
    // Debugger-driven focus alone does not satisfy Windows foreground-lock policy.
    if (process.platform === "win32") {
      const fixturePage = app
        .windows()
        .find((p) => p.url().startsWith("data:"));
      await nativeMouse(app, fixturePage, { x: 40, y: 180 });
    }
    async function area() {
      const next = app.waitForEvent("window");
      await app.evaluate(() => global.frameWorkflow.menuItem("area").click());
      const overlay = await next;
      await overlay.waitForFunction(
        () => document.querySelector("#screen").naturalWidth > 0,
      );
      const win = await app.browserWindow(overlay);
      await expect.poll(() => win.evaluate((w) => w.isVisible())).toBe(true);
      return { overlay, win };
    }
    const { overlay, win } = await area();
    const size = await overlay.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await expect
      .poll(() => win.evaluate((w) => w.getBounds()))
      .toEqual(display.bounds);
    if (process.platform === "win32") {
      // Verify actual OS hit testing, including pixels occupied by the taskbar.
      for (const point of [
        { x: 3, y: 3 },
        { x: size.width - 4, y: 3 },
        { x: 3, y: size.height - 4 },
        { x: size.width - 4, y: size.height - 4 },
        { x: size.width / 2, y: size.height - 4 },
      ])
        await nativeMouse(app, overlay, point, "check");
    }
    assert.equal(
      await win.evaluate((w) =>
        process.platform === "darwin"
          ? w.isSimpleFullScreen()
          : w.isFullScreen(),
      ),
      true,
      "Selection must be an actual full-screen overlay.",
    );
    const previewPromise = app.waitForEvent("window");
    if (process.platform === "win32")
      await nativeMouse(app, overlay, { x: 3, y: 3 }, "drag", {
        x: size.width - 4,
        y: size.height - 4,
      });
    else {
      await overlay.mouse.move(3, 3);
      await overlay.mouse.down();
      await overlay.mouse.move(size.width - 4, size.height - 4, { steps: 12 });
      await overlay.mouse.up();
    }
    const preview = await previewPromise;
    await preview.getByRole("button", { name: "Edit", exact: true }).waitFor();
    const captures = await page.evaluate(() => window.frame.list());
    assert.equal(captures.length, 1);
    assert(Math.abs(captures[0].width - (size.width - 7) * display.scale) <= 2);
    assert(
      Math.abs(captures[0].height - (size.height - 7) * display.scale) <= 2,
    );
    assert.deepEqual(await state(), {
      visible: false,
      fullscreen: false,
      selectors: 0,
      tray: true,
    });
    await preview
      .getByRole("button", { name: "Close preview", exact: true })
      .click()
      .catch((e) => {
        if (!preview.isClosed()) throw e;
      });
    console.log(
      "PASS native full-screen overlay covers every monitor edge/taskbar; full-display drag saves once and returns to tray.",
    );
    // Simulate the selector renderer crashing. The app must close it and recover.
    const broken = await area();
    await broken.win
      .evaluate((w) => w.webContents.forcefullyCrashRenderer())
      .catch(() => {});
    await expect.poll(async () => (await state()).selectors).toBe(0);
    await expect.poll(async () => (await state()).visible).toBe(true);
    await page
      .getByRole("alert")
      .filter({ hasText: /capture selector/i })
      .waitFor();
    assert.equal((await state()).tray, true);
    const retry = await area();
    await retry.overlay.keyboard.press("Escape").catch((e) => {
      if (!retry.overlay.isClosed()) throw e;
    });
    await expect.poll(async () => (await state()).selectors).toBe(0);
    assert.equal((await page.evaluate(() => window.frame.list())).length, 1);
    console.log(
      "PASS selector renderer-crash recovery, visible error, and a new capture/cancel after failure.",
    );

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes("index.html"))
        .maximize();
    });
    await page
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    const source = await page.evaluate(
      async (id) =>
        (await window.frame.sources("screen")).find((s) => s.displayId === id),
      display.id,
    );
    assert(source);
    await page.getByRole("button", { name: source.name, exact: true }).click();
    const nextFull = app.waitForEvent("window");
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const fullPreview = await nextFull;
    await fullPreview
      .getByRole("button", { name: "Edit", exact: true })
      .waitFor();
    const whole = (await page.evaluate(() => window.frame.list()))[0];
    assert.equal(whole.width, Math.round(display.bounds.width * display.scale));
    assert.equal(
      whole.height,
      Math.round(display.bounds.height * display.scale),
    );
    assert.equal((await state()).visible, false);
    assert.equal((await state()).fullscreen, false);
    await fullPreview
      .getByRole("button", { name: "Close preview", exact: true })
      .click()
      .catch((e) => {
        if (!fullPreview.isClosed()) throw e;
      });
    console.log(
      "PASS Full screen button saves native display dimensions and hides the maximized library without leaving it full screen.",
    );

    await app.evaluate(({ BrowserWindow }) => {
      const original = BrowserWindow.prototype.loadFile;
      global.restoreOverlayLoader = () => {
        BrowserWindow.prototype.loadFile = original;
      };
      BrowserWindow.prototype.loadFile = function (file, ...args) {
        if (String(file).endsWith("overlay.html"))
          return Promise.reject(Error("Test selector load failure."));
        return original.call(this, file, ...args);
      };
      global.frameWorkflow.menuItem("area").click();
    });
    await expect.poll(async () => (await state()).visible).toBe(true);
    await page
      .getByRole("alert")
      .filter({ hasText: /capture selector could not load/i })
      .waitFor();
    assert.equal((await state()).selectors, 0);
    await app.evaluate(() => global.restoreOverlayLoader());
    const last = await area();
    await last.overlay.keyboard.press("Escape").catch((e) => {
      if (!last.overlay.isClosed()) throw e;
    });
    await expect.poll(async () => (await state()).selectors).toBe(0);
    assert.deepEqual(
      await app.evaluate(({ ipcMain }) =>
        ["region:ready", "region:finish", "region:error"].map((channel) =>
          ipcMain.listenerCount(channel),
        ),
      ),
      [0, 0, 0],
    );
    assert.equal((await page.evaluate(() => window.frame.list())).length, 2);
    console.log(
      "PASS failed selector load surfaces an error, releases capture locks/listeners, and allows the next capture.",
    );
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
