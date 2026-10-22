const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
if (process.platform !== "win32") process.exit(0);
const root = path.resolve(__dirname, "..");
const source = path.join(root, "native/windows/ShortcutHost.cs");
const output = path.join(root, "assets/native/FrameShortcutHost.exe");
if (
  fs.existsSync(output) &&
  fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs
)
  process.exit(0);
const windows = process.env.SystemRoot || "C:\\Windows";
const compiler = ["Framework64", "Framework"]
  .map((folder) =>
    path.join(windows, "Microsoft.NET", folder, "v4.0.30319", "csc.exe"),
  )
  .find((file) => fs.existsSync(file));
if (!compiler)
  throw new Error(
    "The Windows .NET Framework C# compiler is required to build the shortcut host.",
  );
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync(
  compiler,
  [
    "/nologo",
    "/optimize+",
    "/target:exe",
    "/platform:anycpu",
    "/out:" + output,
    source,
  ],
  { windowsHide: true, stdio: "inherit" },
);
console.log("Built Windows shortcut host.");
