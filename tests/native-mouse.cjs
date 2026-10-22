const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { expect } = require("@playwright/test");
let executable;
async function nativeMouse(app, page, point, action = "click", end) {
  const native = await app.browserWindow(page);
  await expect.poll(() => native.evaluate((w) => w.isVisible())).toBe(true);
  if (!executable) {
    const output = path.resolve(__dirname, "../test-results/mouse-input");
    fs.mkdirSync(output, { recursive: true });
    executable = path.join(output, "MouseProbe.exe");
    execFileSync(
      path.join(
        process.env.SystemRoot,
        "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
      ),
      [
        "/nologo",
        "/target:exe",
        "/out:" + executable,
        path.join(__dirname, "windows-mouse-probe.cs"),
      ],
      { windowsHide: true },
    );
  }
  const target = await native.evaluate((w) => ({
    handle: w.getNativeWindowHandle().readBigUInt64LE().toString(),
    pid: process.pid,
  }));
  const view = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const output = execFileSync(
    executable,
    [
      target.handle,
      String(target.pid),
      String(point.x),
      String(point.y),
      String(view.width),
      String(view.height),
      action,
      ...(end ? [String(end.x), String(end.y)] : []),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  expect(output.trim()).toBe(
    action === "check" ? "CHECKED" : action === "drag" ? "DRAGGED" : "CLICKED",
  );
}
module.exports = { nativeMouse };
