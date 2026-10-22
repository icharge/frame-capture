# CleanShot feature audit — Frame 0.2.0

Audit date: 2026-10-22. Scope: local desktop features only; cloud accounts, upload links, collaboration, hosting, and cloud transcription remain excluded by request.

Frame implements the core screenshot → annotate → local save/export workflow and basic screen/window recording. It is a partial implementation of CleanShot's local feature set. The existence of a toolbar or setting alone is not treated as proof of a working feature.

The comparison uses CleanShot's current [screenshots page](https://cleanshot.com/screenshots), [recording page](https://cleanshot.com/screen-recording), and [complete feature list](https://cleanshot.com/features). This is a capability comparison, not a claim of identical behavior, performance, or source code.

The 0.2.0 workflow update adds tray standby, floating previews and pinned references, area video, floating/tray recording controls, local export conversion, and persisted annotation objects. See [workflow details and verification](background-workflow.md). Native macOS validation is still pending.

## Capture and image editing

| Capability                                                    | Frame status             | Evidence and limits                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display, window, and area screenshots                         | Working on Windows       | Native fixture tests verify pixels, output dimensions, region selection, DPI scaling, and Escape cancellation. One display is captured at a time.                                                                  |
| Frozen area selection                                         | Working on Windows       | Selection uses a frozen screen image, crosshair pointer, and dimensions.                                                                                                                                           |
| Precision selection                                           | Partial                  | No magnifier, numeric capture dimensions, aspect lock, or remembered previous selection.                                                                                                                           |
| Screenshot self-timer                                         | Missing                  | The available countdown applies to video recording only.                                                                                                                                                           |
| Scrolling/stitch capture                                      | Missing                  | No vertical/horizontal stitching or full-page capture.                                                                                                                                                             |
| Arrow, rectangle, ellipse, drawing, text, counters, highlight | Working basic tools      | Every implemented tool is exercised in the editor audit. Advanced arrow/text styles, standalone lines, filled shapes, drawing smoothing, and text-aware highlighting are absent.                                   |
| Sensitive-data redaction                                      | Working solid blocks     | Saved PNG pixel checks confirm opaque coverage. Blur and pixelation are absent.                                                                                                                                    |
| Selection, movement, deletion, undo/redo                      | Working                  | Editor tests verify state changes and pixel restoration. No annotation resize/rotate handles.                                                                                                                      |
| Crop and reset crop                                           | Working                  | Tests verify changed output dimensions and reset. No aspect presets or edge snapping.                                                                                                                              |
| Image resize/rotate/flip                                      | Missing                  | Zoom affects the view only. Padding and cropping do not provide image resampling.                                                                                                                                  |
| Background, padding, rounded corners, shadow                  | Partial equivalent       | Six solid colors plus transparent, adjustable padding/corners, and shadow work. Custom background images, reusable style presets, auto-balance, and framing aspect presets are absent.                             |
| Custom annotation palette / eyedropper                        | Partial                  | Existing presets plus a custom color picker. Selected marks, text fonts/styles/sizes, and step numbers are editable; no screen eyedropper.                                                                         |
| Editable projects                                             | Working local sidecars   | Save copy stores a PNG and validated JSON annotation document referencing the original. Cold-restart reopening/editing is tested. Projects depend on the local originals; a PNG copied alone has flattened pixels. |
| Combine multiple images                                       | Missing                  | Dropping an image imports a separate capture; there is no composition canvas.                                                                                                                                      |
| PNG/JPEG export, image clipboard                              | Working                  | Actual file signatures, dimensions, opaque redaction, original-byte preservation, and native clipboard are checked. Successful editor export also creates a flattened local library copy.                          |
| PNG/JPEG/WebP import                                          | Working via file picker  | The editor audit checks decoded dimensions and exact source bytes for all three formats. Drop/paste handlers exist; native cross-app drag/paste variants are not exhaustively tested.                              |
| Quick Access floating actions / dragging out to another app   | Partial equivalent       | Post-capture Copy/Edit/Play/Save as/Pin works without raising the library. Native drag-out to other apps remains absent.                                                                                           |
| Floating pinned screenshots                                   | Working basic references | Always-on-top, movable/resizable images with pin/unpin/close. No opacity or click-through control.                                                                                                                 |
| OCR and QR reading                                            | Missing                  | No local text extraction, QR decoder, or content search.                                                                                                                                                           |

## Recording

| Capability                                             | Frame status                         | Evidence and limits                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display/window recording                               | Working on Windows                   | Native window capture, playable dimensions, stored bytes, and export are verified.                                                                                                                                                                             |
| Selected-area recording / custom recording dimensions  | Working drag selection               | Display selection feeds a native-resolution canvas crop into the recorder. Tested dimensions and playback; no numeric preset selector.                                                                                                                         |
| MP4 and WebM                                           | Working on Windows                   | Native H.264/AAC and VP9/Opus outputs are decoded independently, seeked, and exported with the correct extension and unchanged encoded bytes.                                                                                                                  |
| GIF                                                    | Missing                              | No GIF encoder or export option.                                                                                                                                                                                                                               |
| Quality/FPS controls                                   | Working                              | Compact/Balanced/High presets and 10–60 fps options; resolution-aware bitrate budgets. Source resolution is preserved; there is no output-resolution selector.                                                                                                 |
| Small-file recording                                   | Implemented and measured             | The documented seven-second 1080p fixture reduced old Frame output from 3.29 MB to 1.15 MB with readable 12 px text and some fidelity/motion-smoothness loss. This is not a FastStone benchmark or a size guarantee. See [measurements](recording-quality.md). |
| Pause/resume, countdown, duration                      | Working on Windows                   | Native tests verify active duration excluding pauses, finite media duration, seeking, and playback.                                                                                                                                                            |
| Microphone narration                                   | Implemented; audio pipeline verified | Synthetic narration exercises mixing and both output codecs without opening the physical microphone. Physical-device/OS consent behavior still needs native device checks.                                                                                     |
| Computer audio                                         | Platform-limited                     | Windows loopback is implemented. Live speaker-loopback capture is not exercised by the synthetic narration test. macOS system audio is disabled.                                                                                                               |
| Long recordings                                        | Limited                              | Chunks remain in memory, with automatic stop around 220 MB. No long-duration/low-memory soak certification.                                                                                                                                                    |
| Camera bubble                                          | Missing                              | No camera device capture or compositing.                                                                                                                                                                                                                       |
| Cursor visibility, click highlights, keystroke overlay | Missing                              | No explicit visibility toggle, click visualization, key overlay, or cursor smoothing.                                                                                                                                                                          |
| Automatic DND / desktop cleanup                        | Missing                              | No notification muting, desktop-icon hiding, or wallpaper cleanup. Frame itself steps aside for screenshots.                                                                                                                                                   |
| Video editor / Studio features                         | Missing                              | Playback/export only. No trimming, smart zoom, video backgrounds, reframing, motion blur, or post-recording cursor effects.                                                                                                                                    |

## Library, shortcuts, and platform behavior

| Capability                                         | Frame status                             | Evidence and limits                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local capture history                              | Working core                             | Persistence across restart, name search, favorites, rename, filtering, and removal/Undo are verified. Search does not inspect image/video content.                                                                                                                     |
| Retention and permanent trash cleanup              | Missing                                  | Removal is soft deletion with a ten-second Undo action. Files remain on disk; there is no automatic expiry or permanent-delete UI. Cancelled/failed temporary export copies follow that soft-delete policy.                                                            |
| Global capture shortcuts                           | Implemented                              | Win+Shift+S takeover is tested through the native hook chain, including repeats, left/right modifiers, disable, quit, crash, and preference persistence. Other default bindings are registered in the desktop main process.                                            |
| User-defined key rebinding                         | Missing                                  | Bindings are fixed; Windows offers only the Win+Shift+S enable/disable switch.                                                                                                                                                                                         |
| All-in-one precision capture mode                  | Partial alternative                      | A command palette and source chooser exist. They do not provide saved selections, numeric dimensions, or aspect lock.                                                                                                                                                  |
| macOS permissions and packaging                    | Implemented; native verification pending | Usage descriptions, explicit microphone request, screen consent entry, denial/settings recovery, and audio-input entitlements are present. Unit tests and mocked Mac UI tests pass. Actual macOS capture, TCC dialogs, signing/notarization, and shortcuts need a Mac. |
| Dark mode, menu-bar/tray workflow, launch at login | Tray/menu-bar implemented                | Closing hides the library; capture, recording, pause/stop, and quit are in the tray. --background starts hidden. Dark mode and login-start preference remain absent.                                                                                                   |
| Cloud                                              | Excluded                                 | No upload, account, telemetry, hosted sharing, or cloud collaboration feature. Tested desktop workflows make no remote web requests.                                                                                                                                   |

## Bugs found and fixed in this audit

1. **Duplicate step labels after deletion:** creating a counter used the remaining counter count, so deleting an earlier label could generate another label 2. New labels continue after the highest remaining number.
2. **Cancelled/failed edited-image export:** a temporary flattened copy could remain visible in the library, and cancellation switched the editor to that copy. Cancel/error now leaves the current editable draft in place and hides the unsuccessful temporary copy.

The new editor regression test reproduced both original bugs before the fixes. It checks tool pixels with undo/redo, imports, moving/deleting annotations, crop/reset, in-session drafts, styling, zoom, preserved originals, opaque saved redaction, and successful/cancelled/failed exports.

## Verification

The audit reran 22 unit tests and the existing desktop, native-area, MP4/WebM, Windows shortcut, and mocked macOS permission workflows. The expanded editor test passes after the fixes. The final 0.1.4 package is checked with the editor and area-capture tests.

```sh
npm test
npm run build
npm run test:desktop
npm run test:region
npm run test:recording
npm run test:shortcuts
npm run test:permissions-ui
npm run test:editor
```

Set `FRAME_EXECUTABLE` to an unpacked Frame executable to run native suites against that package. Windows test fixtures and results are written under ignored `test-results/` and `.frame-test-data/` directories. macOS UI tests deliberately use mocked statuses and must not be interpreted as native Mac certification.

## Suggested next work

These are follow-up priorities, not completed features:

1. Area video recording and a screenshot timer.
2. Floating post-capture actions and pinned references.
3. Editable project persistence plus image resize/rotate.
4. Scrolling capture and on-device OCR.
5. Video trimming/GIF, then recording overlays and Mac system audio.

A parity percentage would hide the significance of these gaps, so none is assigned.

## Frame 0.2.0 verification

The background-workflow update passes 26 unit/conversion tests plus desktop, editor, native area, native MP4/WebM, Windows shortcut, and mocked macOS permission suites. The workflow suite checks hidden startup, tray callbacks, no main-window show event during background capture, pin/copy/edit, area-video dimensions, floating pause and tray stop, exclusion of the bar in decoded screen pixels, format conversion, countdown cancellation, geometry controls, and editable annotations after a cold restart. Native macOS validation remains pending.
