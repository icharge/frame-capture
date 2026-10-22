// Rasterize the original vector mark using the same Chromium engine as the app.
const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
async function main() {
  const root = path.resolve(__dirname, "..");
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(root, ".frame-test-data", "icon"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ args: [root], env });
  try {
    const svg = await fs.readFile(path.join(root, "public/frame.svg"), "utf8");
    const png = await instance.evaluate(async ({ BrowserWindow }, svg) => {
      const win = new BrowserWindow({
        width: 256,
        height: 256,
        frame: false,
        show: false,
        transparent: true,
        webPreferences: {
          offscreen: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await win.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            `<html><body style="margin:0;background:transparent">${svg.replace('width="64" height="64"', 'width="256" height="256"')}</body></html>`,
          ),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const image = await win.capturePage();
      win.close();
      return image.toPNG().toString("base64");
    }, svg);
    const data = Buffer.from(png, "base64");
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.writeFile(path.join(root, "assets/icon.png"), data);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(22, 18);
    await fs.writeFile(
      path.join(root, "assets/icon.ico"),
      Buffer.concat([header, data]),
    );
    console.log("Generated assets/icon.png and assets/icon.ico");
  } finally {
    await instance.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
