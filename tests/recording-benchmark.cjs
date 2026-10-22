const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-results", "recording-benchmark");
async function main() {
  await fs.mkdir(output, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST: "1",
    FRAME_DATA_DIR: path.join(
      root,
      ".frame-test-data",
      "benchmark-" + Date.now(),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  const rows = [];
  try {
    const page = await app.firstWindow();
    await page.getByRole("heading", { name: /^Captures/ }).waitFor();
    const { recorderCandidates } = await import("../src/recording.ts");
    const compact = (format) =>
      recorderCandidates(
        {
          recordingQuality: "compact",
          recordingFormat: format,
          fps: 15,
          systemAudio: false,
        },
        1920,
        1080,
        false,
        () => true,
      )[0];
    const profiles = [
      {
        id: "baseline",
        fps: 30,
        hint: "",
        options: {
          mimeType: "video/webm;codecs=vp9",
          videoBitsPerSecond: 6000000,
        },
      },
      { id: "compact-webm", fps: 15, hint: "detail", options: compact("webm") },
      { id: "compact-mp4", fps: 15, hint: "detail", options: compact("mp4") },
    ];
    for (const profile of profiles) {
      const result = await page.evaluate(async (profile) => {
        if (!MediaRecorder.isTypeSupported(profile.options.mimeType))
          throw new Error("Unsupported codec: " + profile.options.mimeType);
        await document.fonts.ready;
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext("2d", { alpha: false });
        function draw(time) {
          const phase = time >= 5 ? 5 : time;
          ctx.fillStyle = "#f4f6f8";
          ctx.fillRect(0, 0, 1920, 1080);
          ctx.fillStyle = "#17202d";
          ctx.fillRect(0, 0, 1920, 70);
          ctx.fillStyle = "#f9fafb";
          ctx.font = "600 24px Inter";
          ctx.fillText("Frame recorder quality fixture", 36, 44);
          ctx.fillStyle = "#e6ebf2";
          ctx.fillRect(0, 70, 260, 1010);
          ctx.font = "14px Inter";
          ctx.fillStyle = "#263247";
          [
            "Workspace",
            "Screenshots",
            "Recording quality",
            "Small file, clear text",
            "1920 x 1080 native pixels",
          ].forEach((text, i) => ctx.fillText(text, 26, 120 + i * 42));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(285, 95, 1045, 920);
          ctx.strokeStyle = "#d2d9e3";
          ctx.lineWidth = 1;
          ctx.strokeRect(285.5, 95.5, 1045, 920);
          ctx.fillStyle = "#17202d";
          ctx.font = "600 28px Inter";
          ctx.fillText("Review the implementation", 310, 140);
          ctx.font = "14px Inter";
          ctx.fillStyle = "#394a61";
          ctx.fillText(
            "Small text should remain readable at native resolution.",
            310,
            176,
          );
          ctx.save();
          ctx.beginPath();
          ctx.rect(307, 205, 995, 780);
          ctx.clip();
          const scroll = Math.floor(Math.max(0, phase - 1) * 104);
          for (let row = 0; row < 62; row++) {
            const y = 229 + row * 26 - scroll;
            ctx.fillStyle = row % 2 ? "#f3f6fa" : "#ffffff";
            ctx.fillRect(307, y - 18, 995, 25);
            ctx.font = "12px monospace";
            ctx.fillStyle = "#64748b";
            ctx.fillText(String(row + 1).padStart(3, "0"), 320, y);
            ctx.fillStyle = row % 4 === 0 ? "#2548ad" : "#263247";
            ctx.fillText(
              `const capture_${String(row).padStart(2, "0")} = { quality: 'clear text', width: 1920, fps: 15 };`,
              365,
              y,
            );
          }
          ctx.restore();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(1355, 95, 530, 540);
          ctx.fillStyle = "#17202d";
          ctx.font = "600 20px Inter";
          ctx.fillText("Capture activity", 1380, 135);
          for (let i = 0; i < 10; i++) {
            const h = 70 + ((i * 41 + Math.floor(phase * 2) * 19) % 260);
            ctx.fillStyle = i % 2 ? "#5a79c8" : "#a3b5e4";
            ctx.fillRect(1380 + i * 46, 540 - h, 28, h);
          }
          ctx.fillStyle = "#e7eee3";
          ctx.fillRect(1355, 660, 530, 355);
          ctx.fillStyle = "#283e31";
          ctx.font = "14px Inter";
          [
            "Native resolution: 1920 x 1080",
            "Test text: Aa Bb 0123456789",
            "12 px source code, 14 px interface",
            "No downscaling or post-processing",
            "Static text + scrolling + chart updates",
          ].forEach((t, i) => ctx.fillText(t, 1380, 707 + i * 45));
          const px =
              phase >= 5 ? 1210 : 620 + Math.floor(Math.sin(phase * 1.5) * 450),
            py = phase >= 5 ? 920 : 600 + Math.floor(Math.cos(phase) * 180);
          ctx.fillStyle = "#17202d";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + 7, py + 28);
          ctx.lineTo(px + 14, py + 18);
          ctx.lineTo(px + 27, py + 18);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        draw(0);
        const stream = canvas.captureStream(profile.fps);
        stream.getVideoTracks()[0].contentHint = profile.hint;
        const recorder = new MediaRecorder(stream, profile.options);
        const chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        const done = new Promise((resolve, reject) => {
          recorder.onstop = resolve;
          recorder.onerror = reject;
        });
        const start = performance.now();
        const interval = setInterval(
          () => draw((performance.now() - start) / 1000),
          1000 / profile.fps,
        );
        recorder.start(1000);
        await new Promise((r) => setTimeout(r, 7000));
        clearInterval(interval);
        recorder.stop();
        await done;
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 16384)
          binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
        draw(5);
        const reference = canvas.toDataURL("image/png").split(",")[1];
        const video = document.createElement("video");
        const url = URL.createObjectURL(blob);
        video.src = url;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
        });
        const duration = Number.isFinite(video.duration)
          ? video.duration
          : null;
        URL.revokeObjectURL(url);
        return {
          data: btoa(binary),
          reference,
          bytes: bytes.length,
          mime: recorder.mimeType,
          duration,
          encoderBitrate: recorder.videoBitsPerSecond,
        };
      }, profile);
      const extension = profile.options.mimeType.startsWith("video/mp4")
        ? "mp4"
        : "webm";
      const file = path.join(output, profile.id + "." + extension);
      await fs.writeFile(file, Buffer.from(result.data, "base64"));
      await fs.writeFile(
        path.join(output, "reference.png"),
        Buffer.from(result.reference, "base64"),
      );
      const image = path.join(output, profile.id + "-frame.png");
      execFileSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          file,
          "-vf",
          "select=gte(t\\,6)",
          "-frames:v",
          "1",
          image,
        ],
        { windowsHide: true },
      );
      function similarity(crop) {
        const filter = crop
          ? "crop=995:780:307:205,format=yuv444p"
          : "format=yuv444p";
        const analysis = spawnSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-i",
            image,
            "-i",
            path.join(output, "reference.png"),
            "-filter_complex",
            "[0:v]" + filter + "[a];[1:v]" + filter + "[b];[a][b]ssim",
            "-f",
            "null",
            "-",
          ],
          { windowsHide: true, encoding: "utf8" },
        );
        assert.equal(analysis.status, 0, analysis.stderr);
        const score = /All:([0-9.]+)/.exec(analysis.stderr);
        assert(score, "FFmpeg must report SSIM");
        return Number(score[1]);
      }
      const fullFrameSsim = similarity(false),
        textSsim = similarity(true);
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
          { windowsHide: true, encoding: "utf8" },
        ),
      );
      const row = {
        ...profile,
        bytes: result.bytes,
        mime: result.mime,
        browserDuration: result.duration,
        encoderBitrate: result.encoderBitrate,
        codec: probe.streams[0].codec_name,
        width: probe.streams[0].width,
        height: probe.streams[0].height,
        frameRate: probe.streams[0].avg_frame_rate,
        fullFrameSsim,
        textSsim,
        reductionPercent: rows.length
          ? (1 - result.bytes / rows[0].bytes) * 100
          : 0,
        file,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      await fs.writeFile(
        path.join(output, "results.json"),
        JSON.stringify(rows, null, 2),
      );
    }
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.width, 1920);
      assert.equal(row.height, 1080);
    }
    console.log(
      "Comparison uses the old 6 Mbps / 30 fps VP9 settings and current app encoder options. No audio; 7 seconds with scrolling and charts, ending on static 12 px text. SSIM measures the final static frame only, not motion quality or FastStone parity.",
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.stderr?.toString() || error);
  process.exitCode = 1;
});
