const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { WindowsShortcut } = require("../electron/windows-shortcut.cjs");
async function setup(t, enabled = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "frame-shortcut-"));
  t.after(() => fs.rm(directory, { force: true, recursive: true }));
  const manager = new WindowsShortcut({
    executable: path.join(directory, "missing.exe"),
    preferenceFile: path.join(directory, "preference.json"),
    defaultEnabled: enabled,
    onCapture: () => {
      throw new Error("Must not capture");
    },
  });
  t.after(() => manager.dispose());
  return { manager, directory };
}
test("a missing shortcut host reports an inactive fallback instead of claiming to override Windows", async (t) => {
  const { manager } = await setup(t, true);
  const status = await manager.init();
  assert.equal(status.enabled, true);
  assert.equal(status.active, false);
  assert.match(status.error, /Ctrl\+Shift\+2/);
  await manager.setEnabled(false);
  assert.equal(manager.status.error, "");
  assert.equal(manager.status.enabled, false);
});
test("disabled shortcut preference persists and corrupted preferences cannot enable a native hook", async (t) => {
  const { manager, directory } = await setup(t, true);
  await manager.setEnabled(false);
  await manager.init();
  assert.equal(manager.status.enabled, false);
  const file = path.join(directory, "preference.json");
  await fs.writeFile(file, "broken");
  await manager.init();
  assert.equal(manager.status.enabled, false);
  assert.equal(await fs.readFile(file, "utf8"), "broken");
  await assert.rejects(() => manager.setEnabled("yes"), /whether/);
});
