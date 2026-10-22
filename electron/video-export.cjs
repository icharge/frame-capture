const { existsSync } = require("node:fs");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
let active = false;
async function exportVideo(input, destination, format, nativeFormat) {
  if (!["mp4", "webm"].includes(format)) throw new Error("Choose MP4 or WebM.");
  if (active) throw new Error("Wait for the current video export to finish.");
  if (format === nativeFormat) {
    await fs.copyFile(input, destination);
    return;
  }
  active = true;
  const temporary = path.join(
    path.dirname(destination),
    ".frame-export-" + randomUUID() + "." + format,
  );
  try {
    const packaged =
      process.resourcesPath &&
      path.join(process.resourcesPath, "native", "ffmpeg");
    const executable =
      packaged && existsSync(packaged)
        ? packaged
        : require("ffmpeg-static")?.replace("app.asar", "app.asar.unpacked");
    if (!executable)
      throw new Error("Video conversion is unavailable on this platform.");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-map_metadata",
      "-1",
    ];
    args.push(
      ...(format === "mp4"
        ? [
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
          ]
        : [
            "-c:v",
            "libvpx-vp9",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-crf",
            "32",
            "-b:v",
            "0",
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
          ]),
    );
    args.push("-y", temporary);
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let error = "";
      child.stderr.on("data", (chunk) => {
        error = (error + chunk.toString()).slice(-3000);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Video conversion failed. " + error)),
      );
    });
    await fs.rename(temporary, destination);
  } finally {
    active = false;
    await fs.unlink(temporary).catch(() => {});
  }
}
module.exports = { exportVideo };
