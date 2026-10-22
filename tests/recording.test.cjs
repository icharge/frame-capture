const { test } = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../src/recording.ts");
const settings = {
  recordingQuality: "compact",
  recordingFormat: "mp4",
  fps: 15,
  systemAudio: false,
};
test("compact recording preserves native dimensions while budgeting fewer bits for fewer pixels", async () => {
  const { recordingBitrate } = await modulePromise;
  assert.equal(recordingBitrate("compact", 1920, 1080, 15), 2400000);
  assert(recordingBitrate("compact", 1280, 720, 15) < 2400000);
  assert(recordingBitrate("compact", 3840, 2160, 15) > 2400000);
  assert(recordingBitrate("compact", 1920, 1080, 30) > 2400000);
  assert(
    recordingBitrate("high", 1920, 1080, 30) >
      recordingBitrate("balanced", 1920, 1080, 30),
  );
  assert.throws(
    () => recordingBitrate("compact", NaN, 1080, 15),
    /invalid dimensions/,
  );
});
test("codec selection honors the requested container and falls back only to supported codecs", async () => {
  const { recorderCandidates } = await modulePromise;
  const all = recorderCandidates(settings, 1920, 1080, false, () => true);
  assert(all[0].mimeType.startsWith("video/mp4"));
  assert(!all[0].mimeType.includes("mp4a"));
  assert.equal(all[0].audioBitsPerSecond, 64000);
  const withAudio = recorderCandidates(
    { ...settings, systemAudio: true },
    1920,
    1080,
    true,
    () => true,
  );
  assert(withAudio[0].mimeType.includes("mp4a.40.2"));
  assert(withAudio[0].audioBitsPerSecond >= 128000);
  assert(
    recorderCandidates(settings, 1920, 1080, true, (m) =>
      m.includes("vp9"),
    )[0].mimeType.includes("vp9,opus"),
  );
  assert.equal(
    recorderCandidates(settings, 1920, 1080, false, () => false).length,
    0,
  );
  assert(
    recorderCandidates(
      { ...settings, recordingFormat: "webm" },
      1920,
      1080,
      false,
      () => true,
    )[0].mimeType.startsWith("video/webm"),
  );
});
test("recording clock measures active sub-second time and excludes repeated pause intervals", async () => {
  const { RecordingClock } = await modulePromise;
  let time = 100;
  const clock = new RecordingClock(() => time);
  assert.equal(clock.elapsed(), 0);
  clock.start();
  time = 1200;
  clock.pause();
  time = 4200;
  assert.equal(clock.elapsed(), 1100);
  clock.resume();
  time = 4950;
  clock.pause();
  time = 5950;
  clock.resume();
  time = 6200;
  assert.equal(clock.stop(), 2100);
  time = 10000;
  assert.equal(clock.elapsed(), 2100);
  clock.start();
  time = 10125;
  assert.equal(clock.stop(), 125);
});
test("container identity is derived from the actual recorder output", async () => {
  const { recordingMime } = await modulePromise;
  assert.equal(recordingMime("video/mp4;codecs=avc1.640034"), "video/mp4");
  assert.equal(recordingMime("video/webm;codecs=vp9,opus"), "video/webm");
  assert.throws(() => recordingMime("text/plain"), /unsupported video/);
});

test("WebM duration is added without changing unknown-length clusters or encoded bytes", async () => {
  const { webmWithDuration } = await import("../src/webm.ts");
  const header = Buffer.from("1a45dfa3801853806701ffffffffffffff", "hex");
  const info = Buffer.from("1549a966872ad7b1830f4240", "hex");
  const clusters = Buffer.from(
    "1f43b67501ffffffffffffffe78100a384810000801f43b67501ffffffffffffffe7821388a38481000080",
    "hex",
  );
  const blob = new Blob([header, info, clusters], { type: "video/webm" });
  const fixed = Buffer.from(
    await (await webmWithDuration(blob, 6750.25)).arrayBuffer(),
  );
  assert.deepEqual(fixed.subarray(-clusters.length), clusters);
  assert.deepEqual(fixed.subarray(0, header.length), header);
  const durationAt = fixed.indexOf(Buffer.from("448988", "hex"));
  assert(durationAt > 0);
  assert.equal(fixed.readDoubleBE(durationAt + 3), 6750.25);
  assert.equal(fixed[header.length + 4], 0x92); // Info grew by eleven bytes.
  const again = await webmWithDuration(new Blob([fixed]), 9999);
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), fixed);
  // TimestampScale may differ from Chromium's usual one millisecond.
  const alternate = Buffer.from(info);
  alternate.set(Buffer.from("1e8480", "hex"), alternate.length - 3);
  const scaled = Buffer.from(
    await (
      await webmWithDuration(new Blob([header, alternate, clusters]), 4000)
    ).arrayBuffer(),
  );
  assert.equal(
    scaled.readDoubleBE(scaled.indexOf(Buffer.from("448988", "hex")) + 3),
    2000,
  );
  const invalid = new Blob(["truncated"]);
  assert.equal(await webmWithDuration(invalid, 1000), invalid);
  assert.equal(await webmWithDuration(blob, NaN), blob);
});
test("MP4 finalization keeps native encoded bytes and rejects an empty recording", async () => {
  const { finalizeRecording } = await modulePromise;
  const bytes = Buffer.from("000000186674797069736f6d", "hex");
  const result = await finalizeRecording(
    [new Blob([bytes])],
    "video/mp4;codecs=avc1",
    1200,
  );
  assert.equal(result.type, "video/mp4");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  await assert.rejects(() => finalizeRecording([], "video/mp4", 1000), /empty/);
});
