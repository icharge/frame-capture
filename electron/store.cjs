const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_BYTES = 256 * 1024 * 1024;
const MIMES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/webm": ".webm",
  "video/mp4": ".mp4",
};
function safeName(value) {
  return (
    String(value || "Untitled capture")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .trim()
      .slice(0, 120) || "Untitled capture"
  );
}
function clampRect(rect, size) {
  const values = [
    rect?.x,
    rect?.y,
    rect?.width,
    rect?.height,
    size?.width,
    size?.height,
  ];
  if (!values.every(Number.isFinite))
    throw new Error("Invalid capture bounds.");
  const x = Math.max(0, Math.min(Math.floor(rect.x), size.width - 1));
  const y = Math.max(0, Math.min(Math.floor(rect.y), size.height - 1));
  const width = Math.min(Math.floor(rect.width), size.width - x);
  const height = Math.min(Math.floor(rect.height), size.height - y);
  if (width < 2 || height < 2)
    throw new Error("Select an area at least 2 pixels wide and high.");
  return { x, y, width, height };
}
class CaptureStore {
  constructor(root) {
    this.root = root;
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      this.items = JSON.parse(
        await fs.readFile(path.join(this.root, "library.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Capture library could not be read. Your files have been preserved.",
        );
      this.items = [];
    }
    if (!Array.isArray(this.items))
      throw new Error(
        "Capture library is invalid. Your files have been preserved.",
      );
  }
  async persist() {
    const target = path.join(this.root, "library.json");
    await fs.writeFile(target + ".tmp", JSON.stringify(this.items, null, 2));
    await fs.rename(target + ".tmp", target);
  }
  mutate(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  list() {
    return this.items
      .filter((item) => !item.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id, includeDeleted = false) {
    if (typeof id !== "string" || !/^[\da-f-]{36}$/.test(id))
      throw new Error("Invalid capture ID.");
    const item = this.items.find(
      (item) => item.id === id && (includeDeleted || !item.deletedAt),
    );
    if (!item) throw new Error("Capture not found.");
    return item;
  }
  file(id) {
    const item = this.get(id);
    return path.join(this.root, item.id + MIMES[item.mime]);
  }
  async read(id) {
    return {
      data: (await fs.readFile(this.file(id))).toString("base64"),
      mime: this.get(id).mime,
    };
  }
  async add(input) {
    return this.mutate(async () => {
      if (!input || !MIMES[input.mime])
        throw new Error("Use a PNG, JPEG, WebP, MP4, or WebM file.");
      const bytes = Buffer.from(input.bytes || []);
      if (!bytes.length || bytes.length > MAX_BYTES)
        throw new Error("Captures must be between 1 byte and 256 MB.");
      if (
        input.mime.startsWith("image/") &&
        !(
          (bytes[0] === 137 && bytes[1] === 80) ||
          (bytes[0] === 255 && bytes[1] === 216) ||
          bytes.toString("ascii", 0, 4) === "RIFF"
        )
      )
        throw new Error("This image file could not be recognized.");
      const id = randomUUID();
      const item = {
        id,
        name: safeName(input.name),
        kind: input.mime.startsWith("video/") ? "video" : "image",
        mime: input.mime,
        width: Math.min(32768, Math.max(1, Number(input.width) || 1)),
        height: Math.min(32768, Math.max(1, Number(input.height) || 1)),
        bytes: bytes.length,
        duration: Math.max(0, Number(input.duration) || 0),
        createdAt: new Date().toISOString(),
        favorite: false,
        thumbnail:
          typeof input.thumbnail === "string" &&
          input.thumbnail.startsWith("data:image/") &&
          input.thumbnail.length < 500000
            ? input.thumbnail
            : "",
      };
      await fs.writeFile(path.join(this.root, id + MIMES[input.mime]), bytes);
      this.items.push(item);
      try {
        await this.persist();
      } catch (error) {
        this.items.pop();
        await fs
          .unlink(path.join(this.root, id + MIMES[input.mime]))
          .catch(() => {});
        throw error;
      }
      return item;
    });
  }
  async update(id, patch) {
    return this.mutate(async () => {
      const item = this.get(id, true);
      const before = { ...item };
      if ("name" in patch) item.name = safeName(patch.name);
      if (typeof patch.favorite === "boolean") item.favorite = patch.favorite;
      if (typeof patch.deleted === "boolean")
        item.deletedAt = patch.deleted ? new Date().toISOString() : undefined;
      try {
        await this.persist();
      } catch (error) {
        this.items[this.items.indexOf(item)] = before;
        throw error;
      }
      return item;
    });
  }
}
module.exports = { CaptureStore, safeName, clampRect, MAX_BYTES };
