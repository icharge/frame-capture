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

See the [feature-by-feature audit](docs/feature-audit.md) for verified behavior, partial implementations, and the local CleanShot features still missing.

- Screenshot capture: select a display, capture a window, or drag an area on a frozen display overlay. Frame steps aside before capturing.
- Screen/window recording, pause/resume, optional microphone narration, and Windows system audio. Local MP4 (H.264/AAC) and WebM (VP9/Opus) playback and export, with native resolution preserved. A recording automatically stops near 220 MB to keep memory bounded.
- Image editor: arrows, rectangles, ellipses, freehand drawing, text, numbered steps, highlighting, **opaque redaction**, cropping, background colors, padding, corners, and shadows.
- Select, move, and delete annotations; undo/redo; fit and zoom. Draft edits survive navigation within the current app session.
- Save edited copies, preserving originals. PNG/JPEG export and image clipboard copy.
- Local library with persistent capture files, search, favorites, rename, grid/list layouts, and removal with a 10-second Undo action. Removed files remain on disk for recovery; this version does not automatically purge them.
- Import PNG, JPEG, or WebP images through the file picker, drag-and-drop, or clipboard paste.
- Command palette and recording/export preferences.

The practice image is original sample artwork, created only when **Try the editor** is selected.

## Recording size and quality

The default is **Compact · clear text**, **MP4**, and **15 fps**. It suits tutorials, code, documents, and everyday app work. Balanced and High quality presets use 30 fps for smoother scrolling; frame rates from 10 to 60 fps are available. Selecting a quality preset resets the frame rate to that preset's default.

Bitrate scales with the source dimensions and selected frame rate; Frame does not downscale the captured video. At 1920 × 1080, the default requests 2.4 Mbps for video and 64 kbps for narration (128 kbps when system audio is enabled). These are encoder hints, not fixed file sizes. Motion, resolution, hardware, and codec affect the result. MP4 is preferred for compatibility, with supported WebM codecs as a fallback. The library and export extension always match the actual recording format.

Export copies the original encoded video without a second compression pass. New WebM recordings receive duration metadata for playback and seeking; paused time is excluded. The shipped app needs no FFmpeg installation and performs no uploads. See [the recording benchmark](docs/recording-quality.md) for measured size and text-quality results and their limits.

## Shortcuts

| Action                 | Windows               | macOS    |
| ---------------------- | --------------------- | -------- |
| Capture an area        | Ctrl+Shift+2          | ⌘⇧2      |
| Capture a screen       | Ctrl+Shift+3          | ⌘⇧1      |
| Start / stop recording | Ctrl+Shift+9          | ⌘⇧9      |
| Quick actions          | Ctrl+K                | ⌘K       |
| Import / paste image   | Ctrl+O / Ctrl+V       | ⌘O / ⌘V  |
| Save edited copy       | Ctrl+S                | ⌘S       |
| Undo / redo            | Ctrl+Z / Ctrl+Shift+Z | ⌘Z / ⌘⇧Z |

On Windows, **Win+Shift+S** also opens Frame's area selector directly on the display under the pointer. It is enabled by default and can be turned off under **Preferences → Keyboard shortcuts → Use Win+Shift+S for Frame**. It overrides the Snipping Tool chord only while Frame is running; disabling it or quitting restores Windows behavior. No registry or Windows policy changes are made. Ctrl+Shift+2 remains available as a fallback. macOS uses ⌘⇧1 for a full-screen capture to avoid the system's reserved ⌘⇧3 binding.

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

macOS requires **System Settings → Privacy & Security → Screen Recording** permission. Frame requests screen access when you choose a capture, and requests Microphone access when you start a recording with narration enabled. **Preferences → macOS permissions** shows both statuses, offers request/settings buttons, and can refresh the status. After changing a denied permission in System Settings, restart Frame if capture remains blocked. Camera, Accessibility, and Input Monitoring permissions are not requested. System audio is disabled on macOS in this build; microphone narration is supported. See [the permission and shortcut notes](docs/permissions-and-shortcuts.md) for implementation details and the remaining native Mac verification.

## Storage and architecture

Electron uses sandboxed renderers, context isolation, a narrow preload bridge, sender-validated IPC, and a Content Security Policy. The renderer has no Node.js or filesystem access. The main process owns capture, clipboard, dialogs, shortcuts, and file writes.

Capture metadata and UUID-named original files are stored in a `captures` directory under Electron's `userData` location, normally:

- Windows: `%APPDATA%/frame-capture/captures`
- macOS: `~/Library/Application Support/frame-capture/captures`

Use **Preferences → Capture library → Open folder** to find the actual location. Metadata writes are serialized and use a temporary file followed by an atomic rename. A corrupt library is preserved instead of silently reset. `FRAME_DATA_DIR` overrides the data directory for tests or a portable setup.

The web preview stores files in this browser's IndexedDB. Browser data is separate from the desktop library and may be removed by clearing site data.

## Verification

```sh
npm test             # storage, recovery, geometry, recording presets, clock, and WebM headers
npm run build        # TypeScript and production assets
npm run test:desktop # Windows/macOS Electron UI and native capture workflows
npm run test:editor  # every implemented editor tool, imports, crop, drafts, and export recovery
npm run test:region  # native display and drag-to-select capture against an opaque test fixture
npm run test:dev     # Vite development entry, React refresh/CSP, and local editor
npm run test:recording # native MP4/WebM, synthetic audio, pause, seek, decode, and export
npm run benchmark:recording # controlled 1080p size and text-fidelity comparison
npm run test:shortcuts # Windows native hook, area capture, disable/exit, and persistence
npm run test:permissions-ui # mocked macOS consent UI; does not prove native TCC behavior
```

The desktop test uses an isolated profile under `.frame-test-data/` and captures a dedicated test window. It verifies editing, redaction pixels, undo/redo, clipboard, native export, library persistence, native window screenshots, recording/playback, and responsive layouts. Test screenshots are written to `test-results/`.

The Windows shortcut helper is built from `native/windows/ShortcutHost.cs` using the Windows .NET Framework compiler, with no added npm dependency or external service. `npm run build`, `npm start`, and `npm run dev` build it automatically on Windows; other platforms skip it. The native shortcut test installs a protective test hook, synthesizes the requested keys, and uses an opaque fixture so it does not trigger the real Windows Snipping Tool. The permission unit tests cover grant/denial behavior; the permission UI test uses mocked macOS statuses on the host OS.

The dedicated recording test and benchmark require `ffmpeg` and `ffprobe` on PATH for independent decoding and analysis. They capture a test fixture and synthesize narration without accessing the physical microphone. These tools are only test prerequisites and are not required by Frame itself.

Frame covers the core capture/edit/export workflow, with substantial gaps from full CleanShot parity: area video recording, screenshot self-timer, scrolling/stitch capture, OCR, Quick Access/pinned overlays, image resize/rotate, editable project files, custom key rebinding, video trimming, GIF encoding, and camera bubbles are not implemented. macOS configuration is included, but it still needs native capture and permission testing on a Mac. Windows is the platform verified in this workspace.
