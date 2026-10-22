const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { CaptureStore, safeName, clampRect } = require("../electron/store.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new CaptureStore(root);
  await store.init();
  return { store, root };
}
const input = () => ({
  name: "Test image",
  mime: "image/png",
  bytes: png,
  width: 1,
  height: 1,
  thumbnail: "",
});
test("captures survive a restart with their bytes, name, and favorite state", async (t) => {
  const { store, root } = await setup(t);
  const capture = await store.add(input());
  await store.update(capture.id, { name: "Review detail", favorite: true });
  const reopened = new CaptureStore(root);
  await reopened.init();
  assert.equal(reopened.list()[0].name, "Review detail");
  assert.equal(reopened.list()[0].favorite, true);
  assert.equal((await reopened.read(capture.id)).data, png.toString("base64"));
});
test("concurrent writes produce a complete, parseable library", async (t) => {
  const { store, root } = await setup(t);
  await Promise.all(Array.from({ length: 12 }, () => store.add(input())));
  assert.equal(store.list().length, 12);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "library.json"), "utf8"))
      .length,
    12,
  );
});
test("removal is reversible and keeps original file bytes", async (t) => {
  const { store } = await setup(t);
  const item = await store.add(input());
  await store.update(item.id, { deleted: true });
  assert.equal(store.list().length, 0);
  await assert.rejects(() => store.read(item.id), /not found/);
  await store.update(item.id, { deleted: false });
  assert.equal(store.list().length, 1);
  assert.equal((await store.read(item.id)).data, png.toString("base64"));
});
test("invalid IDs cannot escape the capture directory", async (t) => {
  const { store } = await setup(t);
  for (const id of ["../library.json", "C:\\Windows\\test", "", null])
    assert.throws(() => store.file(id), /Invalid capture ID/);
});
test("unsupported files and invalid image data are rejected before writes", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(
    () => store.add({ ...input(), mime: "text/html" }),
    /Use a PNG/,
  );
  await assert.rejects(
    () => store.add({ ...input(), bytes: Buffer.from("<html>") }),
    /recognized/,
  );
  await assert.rejects(
    () => store.add({ ...input(), bytes: Buffer.alloc(0) }),
    /256 MB/,
  );
  assert.equal(store.list().length, 0);
});
test("a corrupted library is preserved instead of overwritten", async (t) => {
  const { root } = await setup(t);
  await fs.writeFile(path.join(root, "library.json"), "broken");
  const store = new CaptureStore(root);
  await assert.rejects(() => store.init(), /preserved/);
  assert.equal(
    await fs.readFile(path.join(root, "library.json"), "utf8"),
    "broken",
  );
});
test("filenames are safe on Windows and macOS", () => {
  assert.equal(safeName("  My:/\\test?*<shot>  "), "Mytestshot");
  assert.equal(safeName("***"), "Untitled capture");
  assert.equal(safeName("a".repeat(200)).length, 120);
});
test("region bounds clamp at display edges and reject empty / invalid crops", () => {
  assert.deepEqual(
    clampRect(
      { x: -5, y: 10, width: 200, height: 200 },
      { width: 100, height: 100 },
    ),
    { x: 0, y: 10, width: 100, height: 90 },
  );
  assert.throws(
    () =>
      clampRect(
        { x: 0, y: 0, width: 1, height: 10 },
        { width: 100, height: 100 },
      ),
    /at least 2/,
  );
  assert.throws(
    () =>
      clampRect(
        { x: NaN, y: 0, width: 10, height: 10 },
        { width: 100, height: 100 },
      ),
    /Invalid capture/,
  );
});

test("MP4 and WebM captures preserve their native extensions, bytes, and duration after restart", async (t) => {
  const { store, root } = await setup(t);
  for (const format of ["mp4", "webm"]) {
    const bytes = Buffer.from("encoded " + format + " fixture");
    const capture = await store.add({
      ...input(),
      mime: "video/" + format,
      bytes,
      width: 1920,
      height: 1080,
      duration: 6.25,
    });
    assert.equal(path.extname(store.file(capture.id)), "." + format);
    const reopened = new CaptureStore(root);
    await reopened.init();
    assert.equal(reopened.get(capture.id).duration, 6.25);
    assert.equal(reopened.get(capture.id).kind, "video");
    assert.equal(
      (await reopened.read(capture.id)).data,
      bytes.toString("base64"),
    );
  }
});
