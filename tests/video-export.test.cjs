const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync, spawnSync } = require("node:child_process");
const { exportVideo } = require("../electron/video-export.cjs");
test("local export preserves native bytes and converts video plus audio between real MP4 and WebM containers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-video-export-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ffmpeg = require("ffmpeg-static"),
    source = path.join(root, "source.mp4"),
    webm = path.join(root, "converted.webm"),
    mp4 = path.join(root, "converted back.mp4");
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ],
    { windowsHide: true },
  );
  await exportVideo(source, path.join(root, "copy.mp4"), "mp4", "mp4");
  assert.deepEqual(
    await fs.readFile(source),
    await fs.readFile(path.join(root, "copy.mp4")),
  );
  await exportVideo(source, webm, "webm", "mp4");
  await exportVideo(webm, mp4, "mp4", "webm");
  for (const [file, video, audio] of [
    [webm, "vp9", "opus"],
    [mp4, "h264", "aac"],
  ]) {
    const decoded = spawnSync(
      ffmpeg,
      ["-hide_banner", "-i", file, "-f", "null", "-"],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.match(decoded.stderr, new RegExp("Video: " + video));
    assert.match(decoded.stderr, new RegExp("Audio: " + audio));
    assert.match(decoded.stderr, /320x180/);
    assert.match(decoded.stderr, /Duration: 00:00:0[12]/);
  }
  await assert.rejects(
    () => exportVideo(source, path.join(root, "bad.gif"), "gif", "mp4"),
    /MP4 or WebM/,
  );
});
