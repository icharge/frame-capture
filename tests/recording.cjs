const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
async function main() {
  const root = path.resolve(__dirname, ".."),
    output = path.join(root, "test-results", "recording-native");
  await fs.mkdir(output, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(
      root,
      ".frame-test-data",
      "recording-" + Date.now(),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    args: process.env.FRAME_EXECUTABLE ? [] : [root],
    env,
    ...(process.env.FRAME_EXECUTABLE
      ? { executablePath: path.resolve(process.env.FRAME_EXECUTABLE) }
      : {}),
  };
  const app = await electron.launch(options);
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const failures = [];
    page.on("pageerror", (e) => failures.push(e.message));
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor();
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Recording countdown", exact: true })
      .selectOption("0");
    await page.getByRole("switch", { name: "Microphone", exact: true }).check();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Frame rate", exact: true })
        .inputValue(),
      "15",
    );
    await page.evaluate(async () => {
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        gain = context.createGain(),
        destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      await context.resume();
      window.frameTestAudio = { context, oscillator, destination };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => destination.stream.clone(),
      });
    });
    await app.evaluate(async ({ BrowserWindow }) => {
      const fixture = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Frame recording fixture",
        backgroundColor: "#f6f7fa",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      await fixture.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<html><body style="font:14px monospace;color:#243247;background:#f6f7fa;padding:30px"><h1>Frame recording fixture</h1><p>Small text at original resolution. Only this test window is recorded.</p><pre>const quality = "compact";\nconst frameRate = 15;\nconst upload = false;</pre><p id="counter"></p><script>let n=0;setInterval(()=>document.getElementById("counter").textContent="Frame update "+(++n),200)</script></body></html>',
          ),
      );
      fixture.setTitle("Frame recording fixture");
      global.recordingFixture = fixture;
    });
    const reports = [];
    for (const format of ["mp4", "webm"]) {
      await page.bringToFront();
      await page
        .getByRole("combobox", { name: "Video format", exact: true })
        .selectOption(format);
      await page
        .getByRole("button", { name: /All captures/ })
        .first()
        .click();
      await page.getByRole("button", { name: /Screen recording/ }).click();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Recording frame rate", exact: true })
          .inputValue(),
        "15",
      );
      await page.getByRole("button", { name: "Windows", exact: true }).click();
      await page
        .getByRole("button", { name: "Frame recording fixture", exact: true })
        .click();
      await page.screenshot({
        path: path.join(output, format + "-recording-options.png"),
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Pause recording", exact: true })
        .waitFor();
      const started = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
      await page
        .getByRole("button", { name: "Pause recording", exact: true })
        .click();
      await new Promise((r) => setTimeout(r, 1100));
      await page
        .getByRole("button", { name: "Resume recording", exact: true })
        .click();
      await new Promise((r) => setTimeout(r, 1500));
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      const wallSeconds = (Date.now() - started) / 1000;
      const video = page.locator(".video-player");
      await video.waitFor();
      const media = await video.evaluate(async (v) => {
        if (v.readyState < 2)
          await new Promise((resolve, reject) => {
            v.onloadeddata = resolve;
            v.onerror = reject;
          });
        v.pause();
        if (!Number.isFinite(v.duration) || v.duration <= 0)
          throw new Error("Video duration must be finite and positive.");
        const target = Math.min(1, v.duration / 2);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Video seeking timed out.")),
            5000,
          );
          v.onseeked = () => {
            clearTimeout(timeout);
            resolve();
          };
          v.currentTime = target;
        });
        return {
          duration: v.duration,
          width: v.videoWidth,
          height: v.videoHeight,
          time: v.currentTime,
        };
      });
      const capture = await page.evaluate(
        async (format) =>
          (await window.frame.list()).find(
            (c) => c.kind === "video" && c.mime === "video/" + format,
          ),
        format,
      );
      assert(
        capture,
        "requested container must be stored with the matching MIME type",
      );
      assert.equal(media.width, capture.width);
      assert.equal(media.height, capture.height);
      assert(
        capture.width >= 1000,
        "native window resolution must be preserved",
      );
      assert(
        Math.abs(media.duration - capture.duration) < 0.5,
        "container and library durations must agree",
      );
      assert(
        wallSeconds - capture.duration > 0.7,
        "paused time must not appear in the recorded duration",
      );
      const bytes = await page.evaluate(
        (id) => window.frame.read(id),
        capture.id,
      );
      const file = path.join(output, "native." + format);
      await fs.writeFile(file, Buffer.from(bytes.data, "base64"));
      const probeResult = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_streams",
          "-show_packets",
          "-show_format",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(probeResult.status, 0, probeResult.stderr);
      assert.equal(
        probeResult.stderr.trim(),
        "",
        "container must not produce decoder errors",
      );
      const probe = JSON.parse(probeResult.stdout);
      const previousDts = new Map();
      for (const packet of probe.packets) {
        const timestamp = Number(packet.dts);
        assert(
          Number.isFinite(timestamp),
          "packet decoding timestamp must be available",
        );
        if (previousDts.has(packet.stream_index))
          assert(
            timestamp > previousDts.get(packet.stream_index),
            "encoded packet timestamps must increase within each stream",
          );
        previousDts.set(packet.stream_index, timestamp);
      }
      const decoded = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          file,
          "-fps_mode",
          "passthrough",
          "-enc_time_base:v",
          "demux",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(decoded.status, 0, decoded.stderr);
      assert.equal(
        decoded.stderr.trim(),
        "",
        "every audio/video packet must decode without errors",
      );
      assert(
        probe.streams.some(
          (s) =>
            s.codec_type === "video" &&
            s.codec_name === (format === "mp4" ? "h264" : "vp9"),
        ),
      );
      assert(
        probe.streams.some(
          (s) =>
            s.codec_type === "audio" &&
            s.codec_name === (format === "mp4" ? "aac" : "opus"),
        ),
        "synthetic narration must be present",
      );
      const exported = path.join(output, "export." + format);
      await app.evaluate(
        ({ dialog }, { file, extension }) => {
          dialog.showSaveDialog = async (_window, options) => {
            global.recordingExportOptions = options;
            return { canceled: false, filePath: file };
          };
        },
        { file: exported, extension: format },
      );
      await page
        .getByRole("button", { name: "Export video", exact: true })
        .click();
      await page
        .getByText("Capture exported to your chosen file.", { exact: true })
        .waitFor();
      assert.equal(
        await app.evaluate(
          () => global.recordingExportOptions.filters[0].extensions[0],
        ),
        format,
      );
      assert.deepEqual(
        await fs.readFile(exported),
        await fs.readFile(file),
        "export must preserve encoded bytes without another lossy transcode",
      );
      reports.push({
        format,
        bytes: capture.bytes,
        width: capture.width,
        height: capture.height,
        libraryDuration: capture.duration,
        playbackDuration: media.duration,
        seek: media.time,
        codecs: probe.streams.map((s) => s.codec_name),
      });
      console.log(
        "PASS " +
          format.toUpperCase() +
          ": native resolution, synthetic narration, paused duration, seeking, playback, correct extension, and lossless file export",
      );
      await page.screenshot({
        path: path.join(output, format + "-playback.png"),
      });
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Dismiss notification", exact: true })
        .click()
        .catch(() => {});
      await page
        .getByRole("button", { name: "Preferences", exact: true })
        .click();
    }
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(reports, null, 2),
    );
    await page.evaluate(() => {
      window.frameTestAudio.oscillator.stop();
      return window.frameTestAudio.context.close();
    });
    await app.evaluate(() => global.recordingFixture.close());
    assert.deepEqual(failures, []);
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.stderr?.toString() || error);
  process.exitCode = 1;
});
