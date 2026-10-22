# Electron vs Tauri for Frame

Reviewed **2026-10-22**. This compares the requirements of Frame, a local screenshot, annotation, and recording utility for Windows and macOS. No Tauri build or comparative performance benchmark has been made.

**Recommendation:** keep Electron for the current release. It already provides the native capture integration that Frame uses and that the Windows tests exercise. Consider Tauri if a smaller download and a lightweight background utility become higher priorities than migration effort. That choice should follow a native capture prototype on both operating systems.

| Area                  | Electron                                                                                                                      | Tauri                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | Bundles Chromium and Node.js. The application controls the browser-engine version it ships.                                   | Rust host with the system webview: WebView2 on Windows and WKWebView on macOS. Engine behavior also depends on the operating system/runtime version.                                                |
| Package size          | Includes a browser runtime, which is a significant part of Frame's distribution.                                              | Avoids bundling Chromium; generally offers a smaller baseline. Native recording libraries or bundled encoders would add to it.                                                                      |
| Screen/window capture | Frame uses the built-in `desktopCapturer` API and a display-media request handler.                                            | Frame's Electron calls would need replacement through Rust/platform APIs or suitable plugins. This is an engineering assessment of the current code, not a claim that Tauri cannot capture screens. |
| Recording             | Frame already uses Chromium's `MediaRecorder` with Electron source selection, optional narration, and Windows loopback audio. | Must validate the media APIs in each platform's webview or implement a native capture/encoding pipeline. A direct host swap does not establish feature parity.                                      |
| UI                    | Existing React editor works in a bundled Chromium engine.                                                                     | React editor can be retained, but CSS, canvas, fonts, clipboard, and media behavior need validation in both WebView2 and WKWebView. Neither framework automatically turns HTML into native widgets. |
| Integration language  | JavaScript/TypeScript and Node.js; native modules can be added.                                                               | Rust backend with a JavaScript/TypeScript UI bridge; platform code can be added.                                                                                                                    |
| Security              | Frame uses sandboxing, context isolation, CSP, and sender-validated, narrow IPC.                                              | Capability and permission configuration can constrain native APIs exposed to windows. Custom commands and input validation still require deliberate design.                                         |
| Local-only operation  | Supported; no account, server, or upload feature is required.                                                                 | Also supported; no account, server, or upload feature is required.                                                                                                                                  |
| Performance           | Measure startup, idle memory, capture latency, recording CPU/GPU load, and dropped frames.                                    | The smaller runtime is a reason to investigate, not proof of faster recording or lower battery use. Compare the same workload on the same machines.                                                 |
| Cost for this project | Dependency maintenance and further feature work.                                                                              | Preserve the UI and file format, replace the host and capture integration, then port the native tests.                                                                                              |

## What a Tauri migration would involve

1. Keep the React components, annotation canvas, design tokens, and the `FrameAPI` contract.
2. Replace the preload/IPC implementation with a Tauri command bridge. Use narrowly scoped capabilities for file dialogs, filesystem operations, clipboard access, and global shortcuts.
3. Implement and test screen/window enumeration, screenshot capture, and multi-display region overlays, including DPI scaling and macOS permissions.
4. Prove recording, audio mixing, pause/resume, export formats, and crash/stop behavior on Windows and macOS. Native capture/encoding code may be preferable to relying on different webview media APIs.
5. Preserve the existing UUID capture files and metadata when moving the host. Port the desktop launch and capture tests before switching the default distribution.

Both versions should continue to store everything locally. A migration would not introduce cloud features.

## Upgraded Electron baseline

Every direct npm dependency is pinned to its stable `latest` release checked on 2026-10-22. The major updates are Electron **45.0.0**, React/React DOM **19.3.1**, Vite **8.3.5**, TypeScript **7.0.2**, Lucide React **1.61.0**, and Playwright **1.64.1**. `package.json` and `package-lock.json` are the authoritative complete dependency set.

Electron 45 removes `clipboard.writeImage()` and `clipboard.readImage()`; Frame uses `clipboard.write()` with a PNG `ClipboardItem`, and native tests read back the image through `clipboard.read()`. See [the clipboard migration guide](https://www.electronjs.org/docs/latest/breaking-changes#api-changed-clipboard-module-rearchitected-to-align-with-the-w3c-clipboard-api).

TypeScript 7's side-effect import checking required adding Vite's client type declarations. The package now declares ESM explicitly for Vite's config loader; Electron entry points and tests remain explicit `.cjs` files. A development-only CSP nonce allows Vite's React refresh preamble while keeping the packaged script policy strict. The app version shown in the browser preview is derived from the package manifest.

`npm run deps:check` queries the package registry. `npm run deps:update` updates exact pins and the lockfile; these are development commands, not shipped application network features. Use `npm ci` for reproducible installations.

## Primary sources

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron display-media request handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts)
- [Electron 45.0.0 release](https://github.com/electron/electron/releases/tag/v45.0.0)
- [Tauri architecture](https://tauri.app/concept/architecture/)
- [Tauri process model and system webviews](https://tauri.app/concept/process-model/)
- [Tauri application size](https://v2.tauri.app/concept/size/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri plugin catalog](https://v2.tauri.app/plugin/)
