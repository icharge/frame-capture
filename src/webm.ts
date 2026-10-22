// Chromium's streaming WebM has an unknown-length Segment and Clusters.
// Add Duration to Info only; never reserialize encoded clusters or their sizes.
// Element definitions: https://www.matroska.org/technical/elements.html
type Element = {
  id: number;
  start: number;
  sizeStart: number;
  data: number;
  end: number;
  unknown: boolean;
};
function readElement(bytes: Uint8Array, start: number, limit: number): Element {
  function vint(offset: number, isId: boolean) {
    const first = bytes[offset];
    if (!first) throw new Error("Invalid WebM element.");
    let length = 1;
    while (!(first & (128 >> (length - 1)))) {
      if (++length > (isId ? 4 : 8))
        throw new Error("Invalid WebM element length.");
    }
    if (offset + length > limit) throw new Error("Truncated WebM header.");
    let value = isId ? first : first & (255 >> length);
    let unknown = !isId && value === 255 >> length;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[offset + i];
      unknown = unknown && bytes[offset + i] === 255;
    }
    if (!unknown && !Number.isSafeInteger(value))
      throw new Error("WebM header is too large.");
    return { value, length, unknown };
  }
  const id = vint(start, true),
    sizeStart = start + id.length,
    size = vint(sizeStart, false);
  const data = sizeStart + size.length,
    end = size.unknown ? limit : data + size.value;
  if (end > limit) throw new Error("Truncated WebM element.");
  return { id: id.value, start, sizeStart, data, end, unknown: size.unknown };
}
function encodeSize(value: number) {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) length++;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = value % 256;
    value = Math.floor(value / 256);
  }
  bytes[0] |= 128 >> (length - 1);
  return bytes;
}
export async function webmWithDuration(
  blob: Blob,
  milliseconds: number,
): Promise<Blob> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return blob;
  // MediaRecorder puts Info in the small initial header. Leave other WebM
  // layouts untouched rather than shifting Cue/SeekHead offsets in imported files.
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  try {
    const ebml = readElement(bytes, 0, bytes.length);
    if (ebml.id !== 0x1a45dfa3) return blob;
    // The Segment extends beyond this header buffer, so read just its ID/size.
    const segmentHeader = bytes.subarray(ebml.end, ebml.end + 12);
    if (
      segmentHeader.length < 12 ||
      segmentHeader[0] !== 0x18 ||
      segmentHeader[1] !== 0x53 ||
      segmentHeader[2] !== 0x80 ||
      segmentHeader[3] !== 0x67 ||
      segmentHeader[4] !== 0x01 ||
      !segmentHeader.subarray(5).every((value) => value === 255)
    )
      return blob;
    const segmentData = ebml.end + 12;
    let info: Element | undefined;
    for (let offset = segmentData; offset < bytes.length;) {
      const element = readElement(bytes, offset, bytes.length);
      if (element.id === 0x114d9b74 || element.id === 0x1f43b675) return blob;
      if (element.id === 0x1549a966) {
        info = element;
        break;
      }
      if (element.unknown) return blob;
      offset = element.end;
    }
    if (!info || info.unknown) return blob;
    let scale = 1_000_000;
    let duration: Element | undefined;
    for (let offset = info.data; offset < info.end;) {
      const element = readElement(bytes, offset, info.end);
      if (element.unknown || element.id === 0xbf) return blob; // CRC needs recomputing.
      if (element.id === 0x4489) duration = element;
      if (element.id === 0x2ad7b1) {
        scale = 0;
        for (const value of bytes.subarray(element.data, element.end))
          scale = scale * 256 + value;
      }
      offset = element.end;
    }
    if (!Number.isFinite(scale) || scale <= 0) return blob;
    const ticks = (milliseconds * 1_000_000) / scale;
    if (duration) {
      const length = duration.end - duration.data;
      if (length !== 4 && length !== 8) return blob;
      const original = new DataView(bytes.buffer, duration.data, length);
      if ((length === 4 ? original.getFloat32(0) : original.getFloat64(0)) > 0)
        return blob;
      const value = new Uint8Array(length),
        view = new DataView(value.buffer);
      if (length === 4) view.setFloat32(0, ticks);
      else view.setFloat64(0, ticks);
      return new Blob(
        [blob.slice(0, duration.data), value, blob.slice(duration.end)],
        { type: blob.type },
      );
    }
    const durationBytes = new Uint8Array(11);
    durationBytes.set([0x44, 0x89, 0x88]);
    new DataView(durationBytes.buffer).setFloat64(3, ticks);
    const size = encodeSize(info.end - info.data + durationBytes.length);
    return new Blob(
      [
        blob.slice(0, info.sizeStart),
        size,
        blob.slice(info.data, info.end),
        durationBytes,
        blob.slice(info.end),
      ],
      { type: blob.type },
    );
  } catch {
    // Preserve the recording if a future Chromium release changes its layout.
    return blob;
  }
}
