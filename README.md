# Frame

A local screenshot and recording app for **Windows and macOS**, inspired by the capture → annotate → export workflow of CleanShot X. Frame has its own interface and branding.

**No cloud features.** No accounts, telemetry, remote fonts, uploads, or sharing servers. Everything is bundled and stored on the device.

## Run

Requires Node.js 22.12 or later and npm. CI uses Node.js 24.

```sh
npm install
npm run build
npm start
```

For development, `npm run dev` starts Vite and Electron together. `npm run dev:web` runs a browser preview; the desktop app provides native area capture, local disk storage, and global shortcuts.

## Runtime choice and dependencies

Frame currently uses Electron. See [the Electron vs Tauri comparison](docs/electron-vs-tauri.md) for capture support, application size, security, migration work, and the recommendation for this app.

All direct npm dependencies are pinned to exact stable versions verified against npm's `latest` tags on **2026-10-22**. Use `npm ci` to reproduce this dependency set. Use `npm run deps:check` to inspect current stable releases, or `npm run deps:update` to update the pins and lockfile; rerun the build and native tests after updates. These maintenance commands contact the package registry; the shipped app has no network service or uploads.

## What works

- Screenshot capture: select a display, capture a window, or drag an area on a frozen display overlay. Frame steps aside before capturing.
- Screen/window recording, pause/resume, optional microphone narration, and Windows system audio. Local WebM export and playback. A recording automatically stops near 220 MB to keep memory bounded.
- Image editor: arrows, rectangles, ellipses, freehand drawing, text, numbered steps, highlighting, **opaque redaction**, cropping, background colors, padding, corners, and shadows.
- Select, move, and delete annotations; undo/redo; fit and zoom. Draft edits survive navigation within the current app session.
- Save edited copies, preserving originals. PNG/JPEG export and image clipboard copy.
- Local library with persistent capture files, search, favorites, rename, grid/list layouts, and removal with a 10-second Undo action. Removed files remain on disk for recovery; this version does not automatically purge them.
- Import PNG, JPEG, or WebP images through the file picker, drag-and-drop, or clipboard paste.
- Command palette and recording/export preferences.

The practice image is original sample artwork, created only when **Try the editor** is selected.

## Shortcuts

| Action                 | Windows               | macOS    |
| ---------------------- | --------------------- | -------- |
| Capture an area        | Ctrl+Shift+2          | ⌘⇧2      |
| Capture a screen       | Ctrl+Shift+3          | ⌘⇧3      |
| Start / stop recording | Ctrl+Shift+9          | ⌘⇧9      |
| Quick actions          | Ctrl+K                | ⌘K       |
| Import / paste image   | Ctrl+O / Ctrl+V       | ⌘O / ⌘V  |
| Save edited copy       | Ctrl+S                | ⌘S       |
| Undo / redo            | Ctrl+Z / Ctrl+Shift+Z | ⌘Z / ⌘⇧Z |

Global capture shortcuts are available while Frame is running. Frame minimizes when recording starts; restore it from the taskbar/Dock for pause controls, or use the stop shortcut. Preferences reports shortcut registration conflicts.

In the editor: **V** select, **A** arrow, **R** rectangle, **E** ellipse, **P** draw, **T** text, **H** highlight, **B** redact, **N** numbered step, **C** crop. Select an annotation and press Delete or Backspace to remove it.

## Build desktop packages

```sh
# On Windows: installable .exe, in release/
npm run dist:win

# On Windows: unpacked app, in release/win-unpacked/
npm run pack:win

# On macOS: DMG and ZIP, in release/
npm run dist:mac
```

Build macOS packages on a Mac. The manual GitHub Actions workflow also produces Windows and macOS artifacts without publishing them. Signing and notarization require your own certificates; current development packages are unsigned.

macOS requires **System Settings → Privacy & Security → Screen Recording** permission, followed by restarting Frame. Microphone permission is requested when narration is enabled. System audio is deliberately disabled on macOS in this build; microphone narration is supported.

## Storage and architecture

Electron uses sandboxed renderers, context isolation, a narrow preload bridge, sender-validated IPC, and a Content Security Policy. The renderer has no Node.js or filesystem access. The main process owns capture, clipboard, dialogs, shortcuts, and file writes.

Capture metadata and UUID-named original files are stored in a `captures` directory under Electron's `userData` location, normally:

- Windows: `%APPDATA%/frame-capture/captures`
- macOS: `~/Library/Application Support/frame-capture/captures`

Use **Preferences → Capture library → Open folder** to find the actual location. Metadata writes are serialized and use a temporary file followed by an atomic rename. A corrupt library is preserved instead of silently reset. `FRAME_DATA_DIR` overrides the data directory for tests or a portable setup.

The web preview stores files in this browser's IndexedDB. Browser data is separate from the desktop library and may be removed by clearing site data.

## Verification

```sh
npm test             # file library, concurrency, recovery, input validation, region geometry
npm run build        # TypeScript and production assets
npm run test:desktop # Windows/macOS Electron UI and native capture workflows
npm run test:region  # native display and drag-to-select capture against an opaque test fixture
npm run test:dev     # Vite development entry, React refresh/CSP, and local editor
```

The desktop test uses an isolated profile under `.frame-test-data/` and captures a dedicated test window. It verifies editing, redaction pixels, undo/redo, clipboard, native export, library persistence, native window screenshots, recording/playback, and responsive layouts. Test screenshots are written to `test-results/`.

This is a working first version, not full CleanShot parity: scrolling/stitch capture, OCR, video trimming, MP4/GIF encoding, camera bubbles, and pinned image overlays are not implemented. macOS configuration is included, but it still needs native capture and permission testing on a Mac. Windows is the platform verified in this workspace.
