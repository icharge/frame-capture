const { _electron: electron } = require("@playwright/test");
const path = require("node:path");
const assert = require("node:assert/strict");
async function main() {
  const root = path.resolve(__dirname, "..");
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(root, ".frame-test-data", `region-${Date.now()}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ args: [root], env });
  try {
    const page = await instance.firstWindow();
    page.setDefaultTimeout(15000);
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor();
    const displayId = await instance.evaluate(
      async ({ BrowserWindow, screen }) => {
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
              '<html><body style="margin:0;background:#e8efe5;width:100%;height:100dvh"></body></html>',
            ),
        );
        fixture.show();
        global.regionFixture = fixture;
        await new Promise((r) => setTimeout(r, 350));
        return String(display.id);
      },
    );
    const source = await page.evaluate(
      async (id) =>
        (await window.frame.sources("screen")).find((s) => s.displayId === id),
      displayId,
    );
    assert(source, "primary display must be available");
    const shot = await page.evaluate(
      (id) => window.frame.screenshot({ mode: "screen", sourceId: id }),
      source.id,
    );
    assert(
      shot.width > 500 && shot.height > 500,
      "full screen capture must contain the display",
    );
    console.log(
      "PASS native full-screen capture against an opaque test fixture",
    );
    const overlayPromise = instance.waitForEvent("window");
    const resultPromise = page.evaluate(
      (id) => window.frame.screenshot({ mode: "region", sourceId: id }),
      source.id,
    );
    const overlay = await overlayPromise;
    await overlay.locator("#screen").waitFor();
    await overlay.waitForFunction(
      () => document.querySelector("#screen").naturalWidth > 0,
    );
    await overlay.mouse.move(60, 70);
    await overlay.mouse.down();
    await overlay.mouse.move(300, 230, { steps: 8 });
    await overlay.mouse.up();
    const result = await resultPromise;
    assert(
      result &&
        result.width >= 230 &&
        result.width <= 500 &&
        result.height >= 150 &&
        result.height <= 340,
      "region crop must reflect selected display pixels at its scale factor",
    );
    const pixels = await instance.evaluate(({ nativeImage }, data) => {
      const image = nativeImage.createFromDataURL(data);
      const bytes = image.getBitmap();
      return Array.from(bytes.subarray(0, 4));
    }, result.data);
    assert.equal(
      pixels[3],
      255,
      "region image must have opaque captured pixels",
    );
    assert(
      pixels[0] > 180 && pixels[1] > 180 && pixels[2] > 180,
      "selected pixels must come from the light test fixture",
    );
    console.log(
      "PASS native drag-to-select overlay, DPI-aware region cropping, and captured pixel content",
    );
    const cancelOverlay = instance.waitForEvent("window");
    const cancelled = page.evaluate(
      (id) => window.frame.screenshot({ mode: "region", sourceId: id }),
      source.id,
    );
    const cancelPage = await cancelOverlay;
    await cancelPage.locator("#help").waitFor();
    await cancelPage.keyboard.press("Escape").catch((error) => {
      if (!error.message.includes("has been closed")) throw error;
    });
    assert.equal(await cancelled, null);
    console.log("PASS Escape cancels area capture cleanly");
    await instance.evaluate(() => global.regionFixture.close());
  } finally {
    await instance.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
