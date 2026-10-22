// Package a matching FFmpeg binary for each Mac architecture.
const path = require("node:path"),
  fs = require("node:fs/promises"),
  { execFileSync } = require("node:child_process");
const { build, Platform, Arch } = require("electron-builder");
async function main() {
  if (process.platform !== "darwin")
    throw Error("Build macOS packages on a Mac.");
  const root = path.resolve(__dirname, ".."),
    installer = require.resolve("ffmpeg-static/install.js");
  for (const architecture of ["arm64", "x64"]) {
    const folder = path.join(root, "assets", "native", "ffmpeg", architecture);
    await fs.mkdir(folder, { recursive: true });
    const binary = path.join(folder, "ffmpeg");
    execFileSync(process.execPath, [installer], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        npm_config_platform: "darwin",
        npm_config_arch: architecture,
        FFMPEG_BIN: binary,
      },
    });
    await build({
      targets: Platform.MAC.createTarget(
        ["dmg", "zip"],
        architecture === "arm64" ? Arch.arm64 : Arch.x64,
      ),
      config: {
        files: [
          ...require("../package.json").build.files,
          "!node_modules/ffmpeg-static/ffmpeg",
        ],
        extraResources: [
          ...require("../package.json").build.extraResources,
          { from: binary, to: "native/ffmpeg" },
          { from: binary + ".LICENSE", to: "native/ffmpeg.LICENSE" },
          { from: binary + ".README", to: "native/ffmpeg.README" },
        ],
      },
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
