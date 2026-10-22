const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const root = path.resolve(__dirname, "..");
const results = path.join(root, "test-results");
async function run() {
  await fs.mkdir(results, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(root, ".frame-test-data", String(Date.now())),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launchOptions = {
    args: process.env.FRAME_EXECUTABLE ? [] : [root],
    env,
    timeout: 60000,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  };
  const app = await electron.launch(launchOptions);
  const failures = [];
  const remoteRequests = [];
  try {
    const manifest = require("../package.json");
    const runtime = await app.evaluate(({ app }) => ({
      app: app.getVersion(),
      electron: process.versions.electron,
    }));
    assert.equal(runtime.app, manifest.version);
    assert.equal(runtime.electron, manifest.devDependencies.electron);
    console.log(
      `Runtime verified: Frame ${runtime.app}, Electron ${runtime.electron}`,
    );
    const page = await app.firstWindow();
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => failures.push(e.message));
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor({ timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    assert(
      policy.includes("script-src 'self';"),
      "packaged scripts must retain the strict production policy",
    );
    assert.equal(await page.evaluate(() => typeof window.frame), "object");
    await page.screenshot({ path: path.join(results, "01-workspace.png") });
    console.log(
      "PASS desktop starts with an isolated preload and an empty local library",
    );
    await page.getByRole("button", { name: "Try the editor" }).click();
    console.log("Opening practice editor");
    const canvas = page.getByLabel("Image annotation canvas");
    await canvas.waitFor();
    await page.waitForFunction(
      () => document.querySelector("canvas")?.width === 1440,
    );
    const box = await canvas.boundingBox();
    await page.getByRole("button", { name: "Redact", exact: true }).click();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, {
      steps: 5,
    });
    await page.mouse.up();
    assert.equal(
      await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(),
      true,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Redo", exact: true }).isEnabled(),
      true,
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    const redactPixel = await canvas.evaluate((c) =>
      Array.from(c.getContext("2d").getImageData(250, 180, 1, 1).data),
    );
    assert(
      redactPixel[0] < 80 && redactPixel[1] < 80 && redactPixel[2] < 100,
      "redaction must be opaque dark pixels",
    );
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await canvas.click({
      position: { x: box.width * 0.2, y: box.height * 0.5 },
    });
    await page
      .getByLabel("Annotation text", { exact: true })
      .fill("A detail to review");
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page
      .getByRole("button", { name: "Mist background", exact: true })
      .click();
    await page.getByRole("switch", { name: "Drop shadow" }).check();
    await page.screenshot({ path: path.join(results, "02-editor.png") });
    await page.getByRole("button", { name: "Save copy", exact: true }).click();
    await page.waitForFunction(
      async () => (await window.frame.list()).length === 2,
    );
    const list = await page.evaluate(() => window.frame.list());
    assert.equal(list.length, 2);
    assert.equal(list.find((c) => c.name.endsWith("— edited")).width, 1568);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    const clip = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const items = await clipboard.read();
      const item = items.find((item) => item.types.includes("image/png"));
      if (!item) throw new Error("Clipboard did not contain a PNG image.");
      const blob = await item.getType("image/png");
      return nativeImage
        .createFromBuffer(Buffer.from(await blob.arrayBuffer()))
        .getSize();
    });
    assert.equal(clip.width, 1568);
    console.log(
      "PASS annotations, opaque redaction, undo/redo, text, background, edited copy, and native clipboard",
    );
    await page
      .getByRole("button", { name: "Back to library", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Favorite Fieldnotes · practice image — edited",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: /Favorites/ })
      .first()
      .click();
    assert.equal(await page.locator(".capture-card").count(), 1);
    await page.getByLabel("Search captures").fill("does not exist");
    await page
      .getByRole("heading", { name: "No matching captures." })
      .waitFor();
    await page.getByLabel("Clear search").click();
    await page
      .getByLabel("Actions for Fieldnotes · practice image — edited")
      .click();
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page.getByLabel("Capture name").fill("Design review");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await page
      .getByRole("button", { name: "Open Design review", exact: true })
      .waitFor();
    await page.getByLabel("Actions for Design review").click();
    await page
      .getByRole("button", { name: "Remove capture", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByRole("button", { name: "Open Design review", exact: true })
      .waitFor();
    console.log("PASS favorites, search, rename, removal, and Undo");
    const exportPath = path.join(results, "export.png");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    await page.getByLabel("Actions for Design review").click();
    await page
      .getByRole("button", { name: "Export file", exact: true })
      .click();
    await page
      .getByText("Capture exported to your chosen file.", { exact: true })
      .waitFor();
    const file = await fs.readFile(exportPath);
    assert.equal(file[0], 137);
    console.log("PASS native PNG export");
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Recording countdown", exact: true })
      .selectOption("0");
    await page
      .getByRole("button", { name: /All captures/ })
      .first()
      .click();
    await page.getByRole("button", { name: /Quick actions/ }).click();
    await page
      .getByRole("textbox", { name: "Find an action" })
      .fill("capture a window");
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Choose a window", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    console.log("PASS preferences and keyboard command palette");
    await app.evaluate(async ({ BrowserWindow }) => {
      const fixture = new BrowserWindow({
        width: 700,
        height: 500,
        title: "Frame capture fixture",
        backgroundColor: "#e8efe5",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await fixture.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<!doctype html><html><body style="margin:0;background:#e8efe5;color:#23372d;font:40px sans-serif;padding:60px"><h1>Frame capture fixture</h1><p>Only this test window is captured.</p></body></html>',
          ),
      );
      fixture.setTitle("Frame capture fixture");
      global.frameFixture = fixture;
    });
    await page.bringToFront();
    const source = await page.evaluate(async () => {
      const sources = await window.frame.sources("window");
      return sources.find((s) => s.name === "Frame capture fixture");
    });
    assert(source, "native desktopCapturer must enumerate the test window");
    const shot = await page.evaluate(
      (id) => window.frame.screenshot({ mode: "window", sourceId: id }),
      source.id,
    );
    assert(
      shot && shot.width > 300 && shot.height > 200,
      "native window capture must return image pixels",
    );
    console.log("PASS native window screenshot using an isolated test window");
    await page.getByRole("button", { name: /Screen recording/ }).click();
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await page
      .getByRole("button", { name: "Frame capture fixture", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .waitFor({ timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resume recording", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Resume recording", exact: true })
      .click();
    await new Promise((r) => setTimeout(r, 1500));
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".video-player").waitFor({ timeout: 20000 });
    const playable = await page.locator(".video-player").evaluate(async (v) => {
      if (v.readyState < 2)
        await new Promise((resolve, reject) => {
          v.onloadeddata = resolve;
          v.onerror = reject;
        });
      return { width: v.videoWidth, height: v.videoHeight };
    });
    assert(
      playable.width > 100 && playable.height > 100,
      "recorded WebM must decode",
    );
    const recorded = await page.evaluate(async () =>
      (await window.frame.list()).find((c) => c.kind === "video"),
    );
    assert(
      recorded && recorded.bytes > 1000,
      "recording bytes must persist on disk",
    );
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    assert((await fs.readFile(exportPath)).length > 1000);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await app.evaluate(() => global.frameFixture.close());
    console.log(
      "PASS native recording, pause/resume, local WebM playback, and video export",
    );
    await page
      .getByRole("button", { name: /All captures/ })
      .first()
      .click();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setMinimumSize(0, 0);
    });
    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        overflow.scroll <= overflow.width,
        `horizontal overflow at ${width}px: ${overflow.scroll}`,
      );
      await page.screenshot({
        path: path.join(results, `responsive-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1380, height: 880 });
    console.log("PASS layouts at 320, 375, 414, 768, and 1280 pixels");
    await page.screenshot({ path: path.join(results, "03-library.png") });
    assert.deepEqual(failures, [], "renderer must not have uncaught errors");
    assert.deepEqual(
      remoteRequests,
      [],
      "desktop workflows must not make remote web requests",
    );
    const final = await page.evaluate(() => window.frame.list());
    await app.close();
    const reopened = await electron.launch(launchOptions);
    const again = await reopened.firstWindow();
    await again
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor();
    const persisted = await again.evaluate(() => window.frame.list());
    assert.equal(persisted.length, final.length);
    assert(persisted.some((c) => c.name === "Design review" && c.favorite));
    await reopened.close();
    console.log("PASS capture library persists across desktop restarts");
  } finally {
    await app.close().catch(() => {});
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
