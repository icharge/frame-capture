const { _electron: electron, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs/promises"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  output = path.join(root, "test-results", "workflow");
async function main() {
  await fs.mkdir(output, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(
      root,
      ".frame-test-data",
      "workflow-" + Date.now(),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    args: process.env.FRAME_EXECUTABLE
      ? ["--background"]
      : [root, "--background"],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  };
  let app = await electron.launch(options),
    page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const menu = async (id) =>
    app.evaluate((_, id) => {
      const item = global.frameWorkflow.menuItem(id);
      if (!item) throw Error("Missing tray item " + id);
      item.click();
    }, id);
  const mainState = () =>
    app.evaluate(() => ({
      visible: global.testMain.isVisible(),
      fullscreen: global.testMain.isFullScreen(),
      shows: global.testShows,
      bar: !!global.frameWorkflow.bar,
      tray: !global.frameWorkflow.tray.isDestroyed(),
    }));
  try {
    await page.getByRole("heading", { name: /^Captures/ }).waitFor();
    await app.evaluate(({ BrowserWindow, screen }) => {
      global.testMain = BrowserWindow.getAllWindows()[0];
      global.testShows = 0;
      global.testMain.on("show", () => global.testShows++);
      const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      );
      global.testDisplay = display;
      const fixture = (global.testFixture = new BrowserWindow({
        ...display.bounds,
        title: "Frame workflow fixture",
        frame: false,
        backgroundColor: "#d13e47",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }));
      fixture.setMenu(null);
      fixture.setBounds(display.bounds);
      fixture.setAlwaysOnTop(true);
      fixture.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<!doctype html><html><body style="margin:0;background:#d13e47;height:100vh;color:white;font:32px sans-serif"><p style="padding:60px">Frame workflow fixture</p></body></html>',
          ),
      );
    });
    assert.equal(
      (await mainState()).visible,
      false,
      "--background must start without showing the library",
    );
    await menu("show");
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByLabel("Recording countdown", { exact: true })
      .selectOption("0");
    await menu("show");
    await app.evaluate(() => {
      global.testMain.close();
    });
    assert.equal((await mainState()).visible, false);
    assert.equal((await mainState()).tray, true);
    await app.evaluate(() => {
      global.testShows = 0;
      global.testFixture.focus();
    });
    const overlayPromise = app.waitForEvent("window");
    await menu("area");
    const overlay = await overlayPromise;
    await overlay.locator("#screen").waitFor();
    const expected = await overlay.evaluate(() => ({
      scale: document.querySelector("#screen").naturalWidth / innerWidth,
      scaleY: document.querySelector("#screen").naturalHeight / innerHeight,
    }));
    const previewPromise = app.waitForEvent("window");
    await overlay.mouse.move(80, 100);
    await overlay.mouse.down();
    await overlay.mouse.move(480, 360, { steps: 8 });
    await overlay.mouse.up();
    let preview = await previewPromise;
    await preview.getByRole("button", { name: "Edit", exact: true }).waitFor();
    assert.equal((await mainState()).shows, 0);
    assert.equal((await mainState()).visible, false);
    assert.equal((await mainState()).fullscreen, false);
    assert.equal(
      await preview.evaluate(() => typeof window.frame),
      "undefined",
    );
    const shot = (await page.evaluate(() => window.frame.list()))[0];
    assert(Math.abs(shot.width - 400 * expected.scale) <= 2);
    assert(Math.abs(shot.height - 260 * expected.scaleY) <= 2);
    await preview.getByRole("button", { name: "Copy", exact: true }).click();
    await preview
      .getByRole("button", { name: "Copied", exact: true })
      .waitFor();
    await preview.getByRole("button", { name: "Pin", exact: true }).click();
    await preview.getByRole("button", { name: "Unpin", exact: true }).waitFor();
    await preview.screenshot({
      path: path.join(output, "floating-capture.png"),
    });
    await preview.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Image annotation canvas").waitFor();
    assert.equal((await mainState()).visible, true);
    console.log(
      "PASS close-to-tray standby, background area capture without main-window flashes/fullscreen, floating copy/pin/edit, and isolated floating API",
    );
    await menu("show");
    await app.evaluate(() => global.testFixture.focus());
    await page
      .getByRole("button", { name: "Screen recording", exact: true })
      .click();
    await page.getByRole("button", { name: "Area", exact: true }).click();
    const fixtureSource = await page.evaluate(async () => {
      const id = await window.frame.info();
      const sources = await window.frame.sources("screen");
      return sources;
    });
    const displayId = await app.evaluate(() => String(global.testDisplay.id));
    const chosenSource = fixtureSource.find((s) => s.displayId === displayId);
    assert(chosenSource);
    await page
      .getByRole("button", { name: chosenSource.name, exact: true })
      .click();
    const areaOverlayPromise = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Select recording area", exact: true })
      .click();
    const areaOverlay = await areaOverlayPromise;
    await areaOverlay.locator("#screen").waitFor();
    const barPromise = app.waitForEvent("window");
    await areaOverlay.mouse.move(80, 100);
    await areaOverlay.mouse.down();
    await areaOverlay.mouse.move(560, 420, { steps: 8 });
    await areaOverlay.mouse.up();
    let bar = await barPromise;
    await expect
      .poll(() =>
        bar
          .getByRole("button", { name: "Pause recording", exact: true })
          .isEnabled(),
      )
      .toBe(true);
    await new Promise((r) => setTimeout(r, 1300));
    await bar
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    await bar
      .getByRole("button", { name: "Resume recording", exact: true })
      .waitFor();
    await new Promise((r) => setTimeout(r, 400));
    await menu("pause");
    await bar
      .getByRole("button", { name: "Pause recording", exact: true })
      .waitFor();
    await new Promise((r) => setTimeout(r, 900));
    const recordPreviewPromise = app.waitForEvent("window");
    await menu("stop");
    preview = await recordPreviewPromise;
    await preview.getByRole("button", { name: "Play", exact: true }).waitFor();
    let captures = await page.evaluate(() => window.frame.list());
    const areaVideo = captures.find((c) => c.kind === "video");
    assert(areaVideo);
    assert(Math.abs(areaVideo.width - 480 * expected.scale) <= 3);
    assert(Math.abs(areaVideo.height - 320 * expected.scaleY) <= 3);
    assert.equal((await mainState()).visible, false);
    await preview.getByRole("button", { name: "Play", exact: true }).click();
    await page.locator(".video-player").waitFor();
    const playable = await page.locator(".video-player").evaluate(async (v) => {
      await v.play();
      return { width: v.videoWidth, height: v.videoHeight };
    });
    assert.equal(playable.width, areaVideo.width);
    const converted = path.join(output, "area-converted.webm");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, converted);
    await page
      .getByLabel("Export video format", { exact: true })
      .selectOption("webm");
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await expect
      .poll(async () => {
        try {
          return (await fs.stat(converted)).size;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(100);
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Export video", exact: true })
          .isEnabled(),
      )
      .toBe(true);
    const convertedBytes = await fs.readFile(converted);
    assert.equal(convertedBytes.subarray(0, 4).toString("hex"), "1a45dfa3");
    console.log(
      "PASS native selected-area recording, floating pause, tray resume/stop, cropped playback dimensions, and WebM format choice during export",
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await menu("show");
    await app.evaluate(() => global.testFixture.focus());
    await page
      .getByRole("button", { name: "Screen recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: chosenSource.name, exact: true })
      .click();
    const fullBarPromise = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    bar = await fullBarPromise;
    await expect
      .poll(() =>
        bar
          .getByRole("button", { name: "Pause recording", exact: true })
          .isEnabled(),
      )
      .toBe(true);
    await app.evaluate(() =>
      global.frameWorkflow.bar.setPosition(
        global.testDisplay.bounds.x + 16,
        global.testDisplay.bounds.y + 16,
      ),
    );
    const position = await app.evaluate(() => ({
      bar: global.frameWorkflow.bar.getBounds(),
      display: global.testDisplay.bounds,
      protected: global.frameWorkflow.bar.isContentProtected(),
    }));
    assert.equal(position.protected, true);
    await bar.screenshot({ path: path.join(output, "recorder-bar.png") });
    await new Promise((r) => setTimeout(r, 1700));
    const fullPreviewPromise = app.waitForEvent("window");
    await bar.getByRole("button", { name: "Stop", exact: true }).click();
    preview = await fullPreviewPromise;
    await preview.getByRole("button", { name: "Play", exact: true }).waitFor();
    captures = await page.evaluate(() => window.frame.list());
    const fullVideo = captures.find(
      (c) => c.kind === "video" && c.id !== areaVideo.id,
    );
    const data = await page.evaluate(
        (id) => window.frame.read(id),
        fullVideo.id,
      ),
      fullFile = path.join(output, "screen.mp4");
    await fs.writeFile(fullFile, Buffer.from(data.data, "base64"));
    const x =
        Math.floor(
          ((position.bar.x - position.display.x + 10) * fullVideo.width) /
            position.display.width /
            2,
        ) * 2,
      y =
        Math.floor(
          ((position.bar.y - position.display.y + 20) * fullVideo.height) /
            position.display.height /
            2,
        ) * 2;
    const pixels = execFileSync(
      require("ffmpeg-static"),
      [
        "-v",
        "error",
        "-ss",
        "0.5",
        "-i",
        fullFile,
        "-vf",
        `crop=2:2:${x}:${y}`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    assert(
      pixels[0] > 150 && pixels[1] < 120 && pixels[2] < 130,
      "recorder controls must be absent from actual screen recording pixels: " +
        [...pixels.subarray(0, 3)],
    );
    assert.equal((await mainState()).visible, false);
    assert.equal((await mainState()).bar, false);
    console.log(
      "PASS protected recorder bar is absent from decoded full-screen video pixels; stopping preserves background standby",
    );
    const previewClosed = preview.waitForEvent("close");
    await preview
      .getByRole("button", { name: "Close preview", exact: true })
      .click()
      .catch((error) => {
        if (!preview.isClosed() || !error.message.includes("closed"))
          throw error;
      });
    await previewClosed;
    await menu("show");
    await app.evaluate(() => global.testFixture.close());
    const fixture = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      c.getContext("2d").fillStyle = "white";
      c.getContext("2d").fillRect(0, 0, 800, 600);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Import image file", { exact: true }).setInputFiles({
      name: "Editable.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture, "base64"),
    });
    await page.getByLabel("Image annotation canvas").waitFor();
    let canvas = page.getByLabel("Image annotation canvas"),
      box = await canvas.boundingBox();
    const clickPoint = async (x, y) => {
      box = await canvas.boundingBox();
      await canvas.click({
        position: { x: (box.width * x) / 800, y: (box.height * y) / 600 },
      });
    };
    await page
      .getByRole("button", { name: "Numbered step", exact: true })
      .click();
    await page.getByLabel("Next number", { exact: true }).fill("10");
    await clickPoint(150, 150);
    await clickPoint(300, 150);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickPoint(150, 150);
    await page.getByLabel("Step number", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page
      .getByLabel("Font family", { exact: true })
      .selectOption("Georgia");
    await page.getByLabel("Font style", { exact: true }).selectOption("italic");
    await page.getByLabel("Font size", { exact: true }).fill("40");
    await clickPoint(150, 300);
    await page
      .getByLabel("Annotation text", { exact: true })
      .fill("First text");
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickPoint(180, 285);
    await page.getByLabel("Text content", { exact: true }).fill("Revised text");
    await page
      .getByLabel("Font family", { exact: true })
      .selectOption("Courier New");
    await page
      .getByLabel("Font style", { exact: true })
      .selectOption("bold-italic");
    await page.getByLabel("Font size", { exact: true }).fill("44");
    await page
      .getByLabel("Custom annotation color", { exact: true })
      .fill("#227744");
    await page.getByRole("button", { name: "Save copy", exact: true }).click();
    await page
      .getByRole("heading", { name: "Editable — edited", exact: true })
      .waitFor();
    const edited = (await page.evaluate(() => window.frame.list())).find(
      (c) => c.name === "Editable — edited",
    );
    const project = await page.evaluate(
      (id) => window.frame.project(id),
      edited.id,
    );
    assert.deepEqual(
      project.document.marks
        .filter((m) => m.type === "step")
        .map((m) => m.number),
      [25, 11],
    );
    const text = project.document.marks.find((m) => m.type === "text");
    assert.equal(text.text, "Revised text");
    assert.equal(text.fontFamily, "Courier New");
    assert.equal(text.fontStyle, "bold-italic");
    assert.equal(text.fontSize, 44);
    assert.equal(text.color, "#227744");
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    await app.evaluate(() => global.frameWorkflow.menuItem("show").click());
    await page.getByRole("heading", { name: /^Captures/ }).waitFor();
    await page
      .getByRole("button", { name: "Open Editable — edited", exact: true })
      .click();
    canvas = page.getByLabel("Image annotation canvas");
    await canvas.waitFor();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickPoint(180, 285);
    await page.getByLabel("Text content", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Text content", { exact: true }).inputValue(),
      "Revised text",
    );
    await page
      .getByLabel("Text content", { exact: true })
      .fill("Editable after restart");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(
      await page.getByLabel("Text content", { exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickPoint(180, 285);
    assert.equal(
      await page.getByLabel("Text content", { exact: true }).inputValue(),
      "Revised text",
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
      true,
      "tray action must show the restarted library/editor window",
    );
    const restoredPixels = await canvas.evaluate(
      (c) => c.toDataURL("image/png").split(",")[1],
    );
    await fs.writeFile(
      path.join(output, "reopened-annotations.png"),
      Buffer.from(restoredPixels, "base64"),
    );
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8, {
      steps: 5,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickPoint(500, 420);
    await page.getByLabel("Annotation width", { exact: true }).fill("300");
    await page.getByLabel("Annotation height", { exact: true }).fill("140");
    const resized = await page.evaluate(
      (id) =>
        JSON.parse(sessionStorage.getItem("frame-draft-" + id)).marks.find(
          (m) => m.type === "rect",
        ),
      edited.id,
    );
    assert.equal(Math.abs(resized.x2 - resized.x), 300);
    assert.equal(Math.abs(resized.y2 - resized.y), 140);
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByLabel("Recording countdown", { exact: true })
      .selectOption("3");
    await menu("show");
    await app.evaluate(async ({ BrowserWindow }) => {
      const f = (global.cancelFixture = new BrowserWindow({
        title: "Frame cancel fixture",
        width: 320,
        height: 240,
      }));
      await f.loadURL("data:text/html,<h1>Cancel recording fixture</h1>");
      f.setTitle("Frame cancel fixture");
    });
    await expect
      .poll(
        () =>
          page.evaluate(async () =>
            (await window.frame.sources("window")).some(
              (s) => s.name === "Frame cancel fixture",
            ),
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Screen recording", exact: true })
      .click();
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await page
      .getByRole("button", { name: "Frame cancel fixture", exact: true })
      .click();
    const beforeCancel = (await page.evaluate(() => window.frame.list()))
      .length;
    const cancelBarPromise = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    const cancelBar = await cancelBarPromise;
    await cancelBar
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => !global.frameWorkflow.bar), {
        timeout: 10000,
      })
      .toBe(true);
    assert.equal(
      (await page.evaluate(() => window.frame.list())).length,
      beforeCancel,
    );
    console.log(
      "PASS shape geometry editing, startup hidden in tray, and countdown cancellation without a new capture",
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          area: { width: areaVideo.width, height: areaVideo.height },
          barExcluded: true,
          stepNumbers: [25, 11],
          editableAfterRestart: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS editable step values/start, text content/family/style/size/color, project reopening after a cold restart, and undo",
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
