# Frame 0.2.0 workflow

Frame is a local capture utility with a compact library window and background tray/menu-bar controls.

- Closing the main window or choosing **Hide to tray** keeps Frame running. Use **Open library** or double-click the Windows tray icon to return. **Quit Frame** exits; an active recording is saved before exit.
- `Frame --background` starts with the library hidden. Launch at login is not configured automatically.
- Tray **Capture area** and the area shortcuts select the display under the pointer directly. Capture does not raise, maximize, or make the library fullscreen.
- A small floating preview offers Copy, Edit/Play, Save as, and Pin for images. Edit/Play opens the main window only on request. Pinned references can be resized and moved. They are hidden during capture and restored afterward.
- Record supports a screen, window, or selected area. Select **Area** in the recording source picker, or **Record area** from the tray. Crop bounds apply to the original display stream; width/height round down by at most one pixel to an even encoder size.
- The floating recorder supports pause/resume, stop, and hiding the controls. The tray/menu bar has the same recording actions and can restore the bar.
- Windows control windows use `WDA_EXCLUDEFROMCAPTURE` through Electron. A native test checks decoded full-screen video pixels underneath the recorder.
- macOS ScreenCaptureKit ignores the exclusion flag. For window recording, the bar is a separate window. For area recording, it is fixed outside the selected pixels or on another display. For full-screen recording without a spare display, controls remain in the menu bar instead. The bar is deliberately omitted when there is no safe placement. These Mac paths need native verification.
- Export offers MP4/H.264 and WebM/VP9 in the player, capture menu, and floating video preview. Exporting the original format copies its bytes. Choosing a different format converts locally with bundled FFmpeg, preserving audio when present. No separate FFmpeg installation or upload is needed.

## Files and editable annotations

The library folder is shown in Preferences → Files → Capture library. It contains:

- `screenshots/<capture-id>.png|jpg|webp`
- `recordings/<capture-id>.mp4|webm`
- `projects/<capture-id>.json` for editable copies
- `library.json` for names, favorites, thumbnails, and the index

Existing captures stored directly in the library root continue to work in place. Removal keeps file bytes for recovery, including originals referenced by editable projects.

Save copy writes a normal flattened PNG and a separate annotation document referencing the original image. Reopening that copy restores the objects, even after an app restart. This is not a standalone interchange project: copying only the PNG to another device retains its visible pixels but not its editable objects. Previously flattened captures from older Frame versions cannot recover their original annotation objects.

Select an annotation to change color/stroke and position; geometry controls also resize shapes and drawings. Text content, family, regular/bold/italic/bold-italic style, pixel size, and custom color are editable. Numbered steps offer **Next number** for a starting value and **Step number** for the selected circle. Undo/redo includes property changes. Original files are preserved.

## Verification

Windows tests cover tray callbacks and window visibility, native area selection, preview copy/pin/edit, selected-area video and dimensions, floating pause/resume, tray stop, actual recorder exclusion from decoded full-screen video, export container conversion with audio, and annotation reopening/editing after a cold restart. Existing editor, desktop, region, recording, and shortcut suites cover the previous core workflows.

Physical microphone and loopback devices, hours-long sessions, native macOS consent/capture, and signing/notarization are not certified by these Windows tests. GIF export, scrolling capture, OCR, arbitrary key rebinding, automatic retention, and video trimming remain outside this release.
