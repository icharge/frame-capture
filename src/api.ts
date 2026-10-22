import type { Capture, CaptureInput, FrameAPI } from "./types";

export function fromDataUrl(data: string): Uint8Array {
  return Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0));
}
export function dataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
export async function imageDetails(src: string) {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = (480 * img.height) / img.width;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumbnail: canvas.toDataURL("image/jpeg", 0.75),
  };
}
let dbPromise: Promise<IDBDatabase>;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("frame-local", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("captures", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function request<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("captures", mode);
    const req = fn(tx.objectStore("captures"));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
type Stored = Capture & {
  data: string;
  deleted?: boolean;
  project?: CaptureInput["project"];
};
async function get(id: string) {
  const item = await request<Stored>("readonly", (s) => s.get(id));
  if (!item) throw new Error("Capture not found.");
  return item;
}
function download(data: string, name: string) {
  const a = document.createElement("a");
  a.href = data;
  a.download = name;
  a.click();
}
const browserAPI: FrameAPI = {
  ready: async () => {},
  hide: async () => {},
  present: async () => {},
  prepareRecording: async (id) => ({ sourceId: id }),
  project: async (id) => {
    const item = await get(id);
    return item.project
      ? { ...item.project, image: await browserAPI.read(item.project.sourceId) }
      : null;
  },
  setSnippingShortcut: async () => {
    throw new Error("Win+Shift+S is available in the Windows desktop app.");
  },
  requestPermission: async () => ({ screen: "prompt", microphone: "prompt" }),
  info: async () => ({
    platform: "browser",
    version: __APP_VERSION__,
    storagePath: "This browser · IndexedDB",
    screenPermission: "prompt",
    microphonePermission: "prompt",
    shortcuts: {},
  }),
  list: async () =>
    (await request<Stored[]>("readonly", (s) => s.getAll()))
      .filter((c) => !c.deleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ data, ...c }) => c),
  read: async (id) => {
    const item = await get(id);
    return { data: item.data.split(",")[1], mime: item.mime };
  },
  save: async (input: CaptureInput) => {
    if (input.bytes.length > 256 * 1024 * 1024)
      throw new Error("Captures must be smaller than 256 MB.");
    const item: Stored = {
      id: crypto.randomUUID(),
      project: input.project,
      name: input.name,
      kind: input.mime.startsWith("video/") ? "video" : "image",
      mime: input.mime,
      width: input.width,
      height: input.height,
      bytes: input.bytes.length,
      duration: input.duration || 0,
      createdAt: new Date().toISOString(),
      favorite: false,
      thumbnail: input.thumbnail,
      data: dataUrl(input.bytes, input.mime),
    };
    await request("readwrite", (s) => s.put(item));
    const { data, ...capture } = item;
    return capture;
  },
  update: async (id, patch) => {
    const item = await get(id);
    Object.assign(item, patch);
    await request("readwrite", (s) => s.put(item));
    const { data, ...capture } = item;
    return capture;
  },
  sources: async () => [],
  screenshot: async () => null,
  recordingSource: async () => {},
  recordingState: async () => {},
  exportFile: async (id, format) => {
    const item = await get(id);
    let data = item.data;
    if (item.kind === "image") {
      const image = await loadImage(data);
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      if (format === "jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0);
      data = canvas.toDataURL(
        format === "jpg" ? "image/jpeg" : "image/png",
        0.95,
      );
    }
    download(
      data,
      item.name +
        "." +
        (item.kind === "video"
          ? item.mime === "video/mp4"
            ? "mp4"
            : "webm"
          : format),
    );
    return true;
  },
  copyImage: async (data) => {
    const blob = new Blob([fromDataUrl(data) as BlobPart], {
      type: "image/png",
    });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  },
  reveal: async () => {
    throw new Error("Open the desktop app to reveal capture files.");
  },
  openFolder: async () => {},
  openPermissions: async () => {},
  onCommand: () => () => {},
};
export const api = window.frame || browserAPI;
export const desktop = !!window.frame;
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
