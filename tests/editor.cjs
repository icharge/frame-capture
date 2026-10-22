const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
async function main() {
  const output = path.join(root, "test-results", "editor-audit");
  await fs.mkdir(output, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(root, ".frame-test-data", "editor-" + Date.now()),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.FRAME_EXECUTABLE ? [] : [root],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  });
  const checks = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor();
    const fixtures = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 800, 600);
      return ["image/png", "image/jpeg", "image/webp"].map((mime) => ({
        mime,
        data: canvas.toDataURL(mime).split(",")[1],
      }));
    });
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i],
        extension = ["png", "jpg", "webp"][i];
      await page
        .getByLabel("Import image file", { exact: true })
        .setInputFiles({
          name: "Audit " + extension + "." + extension,
          mimeType: fixture.mime,
          buffer: Buffer.from(fixture.data, "base64"),
        });
      await page.getByLabel("Image annotation canvas").waitFor();
      await page.waitForFunction(
        () => document.querySelector("canvas")?.width === 800,
      );
      const capture = await page.evaluate(
        async (name) =>
          (await window.frame.list()).find((c) => c.name === name),
        "Audit " + extension,
      );
      assert.equal(capture.mime, fixture.mime);
      assert.equal(capture.width, 800);
      assert.equal(capture.height, 600);
      assert.equal(
        (await page.evaluate((id) => window.frame.read(id), capture.id)).data,
        fixture.data,
      );
      await page
        .getByRole("button", { name: "Back to library", exact: true })
        .click();
    }
    checks.push("PNG/JPEG/WebP imports preserve source bytes and dimensions");
    await page
      .getByRole("button", { name: "Open Audit png", exact: true })
      .click();
    const canvas = page.getByLabel("Image annotation canvas");
    await page.waitForFunction(
      () => document.querySelector("canvas")?.width === 800,
    );
    await page.evaluate(() => document.fonts.ready);
    const original = (await page.evaluate(() => window.frame.list())).find(
      (c) => c.name === "Audit png",
    );
    const documentState = () =>
      page.evaluate(
        (id) => JSON.parse(sessionStorage.getItem("frame-draft-" + id)),
        original.id,
      );
    const imageHash = () => canvas.evaluate((c) => c.toDataURL());
    async function settledCount(count) {
      await page.waitForFunction(
        ({ id, count }) =>
          JSON.parse(sessionStorage.getItem("frame-draft-" + id) || "null")
            ?.marks.length === count,
        { id: original.id, count },
      );
    }
    async function position(x, y) {
      const r = await canvas.boundingBox();
      return { x: r.x + r.width * x, y: r.y + r.height * y };
    }
    async function drag(a, b) {
      const p = await position(...a),
        q = await position(...b);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(q.x, q.y, { steps: 8 });
      await page.mouse.up();
    }
    async function clickAt(x, y) {
      const p = await position(x, y);
      await page.mouse.click(p.x, p.y);
    }
    const gestures = [
      ["Arrow", [0.1, 0.12], [0.35, 0.25]],
      ["Rectangle", [0.5, 0.1], [0.8, 0.25]],
      ["Ellipse", [0.1, 0.35], [0.35, 0.55]],
      ["Draw", [0.5, 0.35], [0.8, 0.55]],
      ["Highlight", [0.1, 0.65], [0.35, 0.8]],
      ["Redact", [0.5, 0.65], [0.8, 0.8]],
    ];
    for (let i = 0; i < gestures.length; i++) {
      const [tool, a, b] = gestures[i],
        before = await imageHash();
      await page.getByRole("button", { name: tool, exact: true }).click();
      await drag(a, b);
      await settledCount(i + 1);
      const after = await imageHash();
      assert.notEqual(after, before, tool + " must change rendered pixels");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await settledCount(i);
      assert.equal(
        await imageHash(),
        before,
        tool + " undo must restore pixels",
      );
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await settledCount(i + 1);
      assert.equal(
        await imageHash(),
        after,
        tool + " redo must restore pixels",
      );
    }
    checks.push(
      "arrow, rectangle, ellipse, drawing, highlight, and redaction render and undo/redo correctly",
    );
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await clickAt(0.15, 0.94);
    await page
      .getByLabel("Annotation text", { exact: true })
      .fill("Audit text");
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await settledCount(7);
    await page
      .getByRole("button", { name: "Numbered step", exact: true })
      .click();
    await clickAt(0.9, 0.15);
    await clickAt(0.9, 0.45);
    await settledCount(9);
    assert.deepEqual(
      (await documentState()).marks
        .filter((m) => m.type === "step")
        .map((m) => m.number),
      [1, 2],
    );
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickAt(0.9, 0.15);
    await page
      .getByRole("button", { name: "Delete annotation", exact: true })
      .click();
    await settledCount(8);
    await page
      .getByRole("button", { name: "Numbered step", exact: true })
      .click();
    await clickAt(0.9, 0.75);
    await settledCount(9);
    assert.deepEqual(
      (await documentState()).marks
        .filter((m) => m.type === "step")
        .map((m) => m.number),
      [2, 3],
      "deleting an earlier step must not create duplicate step labels",
    );
    checks.push("text and numbered steps, including numbering after deletion");
    const arrow = (await documentState()).marks.find((m) => m.type === "arrow");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await drag([0.22, 0.18], [0.25, 0.21]);
    const moved = (await documentState()).marks.find((m) => m.id === arrow.id);
    assert(
      moved.x > arrow.x && moved.y > arrow.y,
      "select/move must reposition an annotation",
    );
    await page.keyboard.press("Delete");
    await settledCount(8);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await settledCount(9);
    checks.push("annotation selection, movement, keyboard deletion, and undo");
    const beforeNavigation = await documentState();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByRole("button", { name: /All captures/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Open Audit png", exact: true })
      .click();
    await canvas.waitFor();
    assert.deepEqual(
      await documentState(),
      beforeNavigation,
      "draft must survive in-session navigation",
    );
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await drag([0.05, 0.05], [0.85, 0.85]);
    const cropped = await canvas.evaluate((c) => ({
      width: c.width,
      height: c.height,
    }));
    assert(
      Math.abs(cropped.width - 640) <= 2 && Math.abs(cropped.height - 480) <= 2,
      "crop must affect output dimensions",
    );
    await page.getByRole("button", { name: "Reset crop", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("canvas")?.width === 800,
    );
    checks.push(
      "in-session draft restoration, crop dimensions, and reset crop",
    );
    await page
      .getByRole("button", { name: "Mist background", exact: true })
      .click();
    await page.locator("#padding").press("Home");
    for (let i = 0; i < 10; i++)
      await page.locator("#padding").press("ArrowRight");
    await page.locator("#corners").press("Home");
    for (let i = 0; i < 8; i++)
      await page.locator("#corners").press("ArrowRight");
    await page.getByRole("switch", { name: "Drop shadow" }).check();
    await page.waitForFunction(
      () => document.querySelector("canvas")?.width === 880,
    );
    assert.equal((await documentState()).padding, 40);
    assert.equal((await documentState()).radius, 16);
    const beforeZoom = await canvas.boundingBox();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert((await canvas.boundingBox()).width > beforeZoom.width);
    assert.equal(
      await canvas.evaluate((c) => c.width),
      880,
      "zoom must not resample the saved image",
    );
    await page.getByRole("button", { name: "Fit image", exact: true }).click();
    checks.push("background, padding, rounded corners, shadow, zoom, and fit");
    const beforeCancel = await documentState();
    const libraryBeforeCancel = (await page.evaluate(() => window.frame.list()))
      .length;
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent.trim() === "Export",
        )?.disabled === false,
    );
    assert.equal(
      (await page.evaluate(() => window.frame.list())).length,
      libraryBeforeCancel,
      "cancelling export must not add a visible library copy",
    );
    await page
      .getByRole("heading", { name: "Audit png", exact: true })
      .waitFor();
    assert.deepEqual(
      await documentState(),
      beforeCancel,
      "cancelling export must preserve the editable draft",
    );
    checks.push(
      "cancelled export leaves the library and current editable draft unchanged",
    );
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => {
        throw new Error("Audit export failure");
      };
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByText(/Audit export failure/).waitFor();
    assert.equal(
      (await page.evaluate(() => window.frame.list())).length,
      libraryBeforeCancel,
      "failed export must not add a visible library copy",
    );
    assert.deepEqual(
      await documentState(),
      beforeCancel,
      "failed export must preserve the editable draft",
    );
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    checks.push(
      "failed export removes its visible temporary copy and preserves edits",
    );
    await page.screenshot({ path: path.join(output, "editor.png") });
    await page.getByRole("button", { name: "Save copy", exact: true }).click();
    await page.waitForFunction(async () =>
      (await window.frame.list()).some((c) => c.name === "Audit png — edited"),
    );
    const edited = (await page.evaluate(() => window.frame.list())).find(
      (c) => c.name === "Audit png — edited",
    );
    assert.equal(edited.width, 880);
    assert.equal(edited.height, 680);
    assert.equal(
      (await page.evaluate((id) => window.frame.read(id), original.id)).data,
      fixtures[0].data,
      "editing must preserve original bytes",
    );
    const stored = await page.evaluate(
      (id) => window.frame.read(id),
      edited.id,
    );
    const pixels = await app.evaluate(({ nativeImage }, data) => {
      const image = nativeImage.createFromBuffer(Buffer.from(data, "base64")),
        b = image.getBitmap(),
        size = image.getSize();
      const offset = (480 * size.width + 640) * 4;
      return Array.from(b.subarray(offset, offset + 4));
    }, stored.data);
    assert(
      pixels[0] < 90 && pixels[1] < 90 && pixels[2] < 100 && pixels[3] === 255,
      "saved redaction must be opaque",
    );
    await fs.writeFile(
      path.join(output, "edited.png"),
      Buffer.from(stored.data, "base64"),
    );
    for (const format of ["png", "jpg"]) {
      const file = path.join(output, "export." + format);
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
      assert.equal(
        await page.evaluate(
          ({ id, format }) => window.frame.exportFile(id, format),
          { id: edited.id, format },
        ),
        true,
      );
      const bytes = await fs.readFile(file);
      const decodedSize = await app.evaluate(
        ({ nativeImage }, data) =>
          nativeImage.createFromBuffer(Buffer.from(data, "base64")).getSize(),
        bytes.toString("base64"),
      );
      assert.deepEqual(
        decodedSize,
        { width: 880, height: 680 },
        "exported image must decode at the expected dimensions",
      );
      if (format === "png")
        assert.deepEqual(
          bytes.subarray(0, 8),
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
      else assert.equal(bytes.readUInt16BE(0), 0xffd8);
    }
    checks.push(
      "saved copies preserve originals; PNG/JPEG exports contain real image bytes; redaction stays opaque",
    );
    const uiExport = path.join(output, "editor-export.png");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, uiExport);
    const beforeUiExport = (await page.evaluate(() => window.frame.list()))
      .length;
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.waitForFunction(
      async (count) => (await window.frame.list()).length === count + 1,
      beforeUiExport,
    );
    await page
      .getByRole("heading", {
        name: "Audit png — edited — export",
        exact: true,
      })
      .waitFor();
    assert.equal((await fs.readFile(uiExport))[0], 137);
    checks.push(
      "successful editor export writes a PNG and opens the exported local copy",
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        { version: require("../package.json").version, checks },
        null,
        2,
      ),
    );
    for (const check of checks) console.log("PASS " + check);
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
