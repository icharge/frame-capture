const KINDS = ["screen", "microphone"];
function permissionRequestAllowed(permission, details = {}) {
  if (!details.isMainFrame) return false;
  if (permission === "display-capture") return true;
  return (
    permission === "media" &&
    Array.isArray(details.mediaTypes) &&
    details.mediaTypes.length > 0 &&
    details.mediaTypes.every((type) => type === "audio")
  );
}
function permissionCheckAllowed(permission, details = {}) {
  if (!details.isMainFrame) return false;
  return (
    permission === "display-capture" ||
    (permission === "media" && details.mediaType !== "video")
  );
}
function createPermissions({
  platform,
  systemPreferences,
  desktopCapturer,
  shell,
}) {
  function validate(kind) {
    if (!KINDS.includes(kind))
      throw new Error("Choose screen or microphone permissions.");
  }
  function status() {
    return {
      screen:
        platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "granted",
      microphone: ["darwin", "win32"].includes(platform)
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "unknown",
    };
  }
  async function listSources(options) {
    const sources = await desktopCapturer.getSources(options);
    if (platform === "darwin" && status().screen !== "granted")
      throw new Error(
        "Screen Recording access is required. Allow Frame in System Settings → Privacy & Security → Screen Recording, then restart Frame.",
      );
    return sources;
  }
  async function request(kind) {
    validate(kind);
    if (platform === "darwin") {
      if (kind === "microphone" && status().microphone === "not-determined")
        await systemPreferences.askForMediaAccess("microphone");
      else if (kind === "screen" && status().screen !== "granted")
        await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        });
    }
    return status();
  }
  async function open(kind = "screen") {
    validate(kind);
    if (platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_" +
          (kind === "screen" ? "ScreenCapture" : "Microphone"),
      );
      return true;
    }
    if (platform === "win32" && kind === "microphone") {
      await shell.openExternal("ms-settings:privacy-microphone");
      return true;
    }
    return false;
  }
  return { status, listSources, request, open };
}
module.exports = {
  createPermissions,
  permissionRequestAllowed,
  permissionCheckAllowed,
};
