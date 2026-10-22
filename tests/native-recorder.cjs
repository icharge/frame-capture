const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { expect } = require("@playwright/test");
let executable;

// Playwright's DOM clicks bypass Windows activation and native drag hit testing.
// Use real mouse input without pre-focusing the bar, so the first click is tested.
async function nativeRecorderClick(app, page, id) {
  const button = page.locator("#" + id);
  await expect(button).toBeEnabled();
  const native = await app.browserWindow(page);
  await expect.poll(() => native.evaluate((w) => w.isVisible())).toBe(true);
  if (process.platform !== "win32") {
    await button.click();
    return;
  }
  if (!executable) {
    const output = path.resolve(__dirname, "../test-results/recorder-input");
    fs.mkdirSync(output, { recursive: true });
    executable = path.join(output, "RecorderProbe.exe");
    execFileSync(
      path.join(
        process.env.SystemRoot,
        "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
      ),
      [
        "/nologo",
        "/target:exe",
        "/out:" + executable,
        path.join(__dirname, "windows-recorder-probe.cs"),
      ],
      { windowsHide: true },
    );
  }
  const target = await native.evaluate((w) => {
    if (global.frameWorkflow.bar !== w || !w.isVisible())
      throw Error("Target must be the visible recorder.");
    return {
      handle: w.getNativeWindowHandle().readBigUInt64LE().toString(),
      pid: process.pid,
    };
  });
  const bounds = await button.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      width: innerWidth,
      height: innerHeight,
    };
  });
  const output = execFileSync(
    executable,
    [
      target.handle,
      String(target.pid),
      String(bounds.x),
      String(bounds.y),
      String(bounds.width),
      String(bounds.height),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  expect(output.trim()).toBe("CLICKED");
}
module.exports = { nativeRecorderClick };
