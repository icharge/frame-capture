const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
for (const file of fs
  .readdirSync(path.join(__dirname, "../electron"))
  .filter((f) => /\.(cjs|js)$/.test(f))) {
  const result = spawnSync(
    process.execPath,
    ["--check", path.join(__dirname, "../electron", file)],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
