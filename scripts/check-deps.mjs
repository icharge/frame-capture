import { readFile, writeFile } from "node:fs/promises";

const packageUrl = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(await readFile(packageUrl, "utf8"));
const entries = Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
});
const rows = await Promise.all(
  entries.map(async ([name, declared]) => {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new Error(`${name}: registry returned ${response.status}`);
    const metadata = await response.json();
    if (!/^\d+\.\d+\.\d+$/.test(metadata.version))
      throw new Error(
        `${name}: latest tag is not a stable release (${metadata.version})`,
      );
    return {
      name,
      declared,
      latest: metadata.version,
      engines: metadata.engines || {},
      peers: metadata.peerDependencies || {},
    };
  }),
);
console.log(JSON.stringify(rows, null, 2));
if (process.argv.includes("--write")) {
  for (const row of rows) {
    const section =
      row.name in manifest.dependencies
        ? manifest.dependencies
        : manifest.devDependencies;
    section[row.name] = row.latest;
  }
  await writeFile(packageUrl, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    "Pinned every direct dependency to its current stable latest release.",
  );
}
