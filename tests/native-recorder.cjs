const { expect } = require("@playwright/test");
const { nativeMouse } = require("./native-mouse.cjs");

// Do not pre-focus the bar: the first native click must work.
async function nativeRecorderClick(app, page, id) {
  const button = page.locator("#" + id);
  await expect(button).toBeEnabled();
  const native = await app.browserWindow(page);
  await expect.poll(() => native.evaluate((w) => w.isVisible())).toBe(true);
  if (process.platform !== "win32") {
    await button.click();
    return;
  }
  await native.evaluate((w) => {
    if (global.frameWorkflow.bar !== w)
      throw Error("Target must be the recorder.");
  });
  const point = await button.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await nativeMouse(app, page, point);
}
module.exports = { nativeRecorderClick };
