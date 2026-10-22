const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { CaptureStore } = require("../electron/store.cjs"),
  { validDocument } = require("../electron/projects.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const input = {
  name: "Original",
  mime: "image/png",
  bytes: png,
  width: 1,
  height: 1,
  thumbnail: "",
};
const document = {
  marks: [
    {
      id: "text-1",
      type: "text",
      x: 0,
      y: 10,
      x2: 0,
      y2: 10,
      color: "#cc3344",
      size: 5,
      text: "Editable",
      fontFamily: "Georgia",
      fontStyle: "italic",
      fontSize: 36,
    },
  ],
  crop: null,
  padding: 0,
  radius: 0,
  shadow: false,
  background: "none",
};
test("annotation projects survive restart and original removal, with separate media and document files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-project-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new CaptureStore(root);
  await store.init();
  const source = await store.add(input);
  const edited = await store.add({
    ...input,
    name: "Edited",
    project: { sourceId: source.id, document },
  });
  assert.equal(
    path.dirname(store.file(source.id)),
    path.join(root, "screenshots"),
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(root, "projects", edited.id + ".json"),
        "utf8",
      ),
    ),
    document,
  );
  await store.update(source.id, { deleted: true });
  const reopened = new CaptureStore(root);
  await reopened.init();
  assert.deepEqual((await reopened.project(edited.id)).document, document);
  assert.equal(
    (await reopened.read(source.id, true)).data,
    png.toString("base64"),
  );
  await reopened.add({ ...input, project: { sourceId: source.id, document } });
});
test("legacy captures remain readable without moving or rewriting original files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-legacy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const id = "11111111-1111-1111-1111-111111111111";
  await fs.writeFile(path.join(root, id + ".png"), png);
  await fs.writeFile(
    path.join(root, "library.json"),
    JSON.stringify([
      {
        id,
        name: "Legacy",
        kind: "image",
        mime: "image/png",
        createdAt: new Date().toISOString(),
      },
    ]),
  );
  const store = new CaptureStore(root);
  await store.init();
  assert.equal((await store.read(id)).data, png.toString("base64"));
  assert.equal(await store.project(id), null);
});
test("invalid project properties cannot be persisted as editable annotations", () => {
  for (const change of [
    { fontFamily: "url(evil)" },
    { color: "javascript:bad" },
    { fontSize: Infinity },
    { number: -1 },
    { type: "html" },
    { points: [{ x: NaN, y: 0 }] },
  ]) {
    assert.throws(() =>
      validDocument({
        ...document,
        marks: [{ ...document.marks[0], ...change }],
      }),
    );
  }
});
