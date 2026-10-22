const { _electron: electron } = require("@playwright/test");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const { createServer } = await import("vite");
  const root = path.resolve(__dirname, "..");
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
  });
  await server.listen();
  let app;
  try {
    const response = await fetch("http://127.0.0.1:5173");
    assert.equal(
      response.status,
      200,
      "Vite must serve on Electron's loopback URL",
    );
    const env = {
      ...process.env,
      FRAME_TEST: "1",
      FRAME_DATA_DIR: path.join(
        root,
        ".frame-test-data",
        `development-${Date.now()}`,
      ),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [root, "--dev"], env, timeout: 60000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error("Renderer:", message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "Good work. Worth capturing." })
      .waitFor({ timeout: 15000 })
      .catch(async (error) => {
        console.error("Page errors:", errors);
        console.error(
          "Loaded scripts:",
          await page
            .locator("script")
            .evaluateAll((scripts) =>
              scripts.map((s) => ({
                src: s.src,
                nonce: s.nonce,
                inline: s.textContent?.slice(0, 100),
              })),
            ),
        );
        throw error;
      });
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    assert(
      policy.includes("'nonce-"),
      "Vite development modules must receive a nonce",
    );
    assert(
      !policy.includes("script-src 'self' 'unsafe-inline'"),
      "development must not broadly allow inline scripts",
    );
    await page.getByRole("button", { name: "Try the editor" }).click();
    await page.getByLabel("Image annotation canvas").waitFor();
    await page.waitForFunction(
      () => document.querySelector("canvas")?.width === 1440,
    );
    const version = await page.evaluate(() => window.frame.info());
    assert.equal(version.version, require("../package.json").version);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Vite 8 development entry, React refresh preamble under CSP, local editor, and manifest version",
    );
  } finally {
    await app?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
