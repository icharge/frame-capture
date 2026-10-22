import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import manifest from "./package.json" with { type: "json" };

const developmentNonce = globalThis.crypto.randomUUID();

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "frame-development-csp",
      apply: "serve",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace(
            "script-src 'self'",
            `script-src 'self' 'nonce-${developmentNonce}'`,
          ),
      },
    },
  ],
  html: command === "serve" ? { cspNonce: developmentNonce } : undefined,
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
}));
