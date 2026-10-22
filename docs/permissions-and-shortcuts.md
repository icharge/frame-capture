# Permissions and keyboard shortcuts

Frame 0.1.3 keeps all captures on the device and requests access only for features the user invokes.

## Windows Win+Shift+S

Windows reserves Win+Shift+S for Snipping Tool. Electron's regular global shortcut registration cannot reliably replace an existing OS binding. Frame uses a small dedicated Windows keyboard-hook process for this chord.

It suppresses only the S press/release for Win+Shift+S (left/right modifiers supported, Ctrl/Alt excluded). Holding S does not open repeated overlays. Other keys pass through; the helper stores modifier state only and emits a capture signal, never typed text. A shell mask prevents Start opening when Win is released.

The chord opens area selection directly on the display containing the pointer. Ctrl+Shift+2 remains an alternative. The preference **Use Win+Shift+S for Frame** is enabled by default on Windows and survives restarts. Turning it off stops the helper. Quitting terminates it, and an explicit parent-process watcher releases the hook after an unexpected parent exit. There are no registry edits, Snipping Tool removals, startup services, or persistent OS remaps. Another keyboard interceptor or a restricted desktop can still interfere; the preferences page reports a helper startup failure.

The helper runs without administrator elevation in normal app use. It is built from the checked-in C# source using the installed Windows .NET Framework compiler, then placed outside the ASAR archive for execution. No native-hook code runs on macOS.

## macOS consent

- **Screen Recording:** choosing a screenshot or recording source invokes Electron's native source enumeration, which enters the macOS capture-consent flow. Frame checks the OS status afterward and refuses apparently available sources if permission is not granted, avoiding a misleading blank capture.
- **Microphone:** only starting a recording with narration enabled, or pressing Request access in preferences, invokes `askForMediaAccess("microphone")` when consent is not determined. A prior denial is not repeatedly prompted; the app directs the user to System Settings.
- **Recovery:** Preferences shows separate statuses and request/settings controls. Changing a denied permission can require restarting Frame; Check permissions refreshes the displayed status.
- **Camera and other access:** media permission requests allow microphone audio only. Camera requests, subframes, and unrelated capabilities are denied. Display capture is separate and still requires a selected source from the app. Frame does not request Accessibility or Input Monitoring, and it has no camera feature.
- **System audio:** disabled on macOS, including stale saved preferences. This version does not request CoreAudio tap access or claim macOS loopback support.

`NSMicrophoneUsageDescription` and `NSScreenCaptureUsageDescription` explain the capture purpose in the bundle metadata. The app and its signed helpers use explicit entitlements for Electron JIT support and `com.apple.security.device.audio-input` for narration. Proper Developer ID signing and notarization still require the owner's Apple credentials.

The app reads permission status at startup without asking for access. It does not call `askForMediaAccess("screen")`; Electron supports that API only for microphone and camera. Screen consent is handled through native capture enumeration.

## macOS shortcuts

Frame uses **⌘⇧2** for area capture, **⌘⇧1** for full-screen capture, and **⌘⇧9** to start/stop recording. Apple's ⌘⇧3/4/5 shortcuts are left to the system. Registration conflicts with another app are shown in preferences.

## Verification and limits

- Unit tests cover first requests, grants, denials, no repeated microphone prompt after denial, denied screen capture, valid settings targets, and the renderer media permission policy.
- The Windows native test installs an independent protective hook before Frame, then injects both left/right Win+Shift+S and repeated keydown. It verifies that Frame prevents the chord reaching the next hook, opens the area overlay, saves a selected crop, passes unrelated keys, and releases the chord on disable, normal exit, and an unexpected parent exit. It also verifies preference persistence.
- The macOS UI test substitutes permission statuses in the test main process. It checks request actions, denial/settings recovery, status refresh, the Mac shortcut label, and absence of Windows-only controls.

This workspace is Windows. These checks validate code, configuration, and UI behavior; they do not prove native macOS TCC prompts, signing, ScreenCaptureKit capture, or microphone recording. Validate those on a Mac using an installed packaged app. During development, macOS may attribute permissions to Electron or its launching terminal/IDE rather than the final Frame bundle.

For a native Mac check, start without existing Frame grants, confirm startup does not prompt, try screenshot source selection and both deny/grant paths, restart after changing a denial, record with narration off/on, and check all three Frame shortcuts. Verify the signed app's Info.plist and entitlements with `plutil` and `codesign -d --entitlements :-`.

## Primary references

- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut): registration fails when a shortcut is already owned.
- [Windows LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc): suppression and message-loop requirements.
- [Electron systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences): consent status and supported prompt APIs.
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer): macOS capture consent and audio limitations.
- [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/): usage metadata, signing, and entitlements.
- [Apple screenshot shortcuts](https://support.apple.com/en-us/102646): system screenshot bindings.
