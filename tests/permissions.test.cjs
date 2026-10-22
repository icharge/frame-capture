const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPermissions,
  permissionRequestAllowed,
  permissionCheckAllowed,
} = require("../electron/permissions.cjs");
function fixture({
  screen = "not-determined",
  microphone = "not-determined",
  grant = true,
  platform = "darwin",
} = {}) {
  const calls = [],
    state = { screen, microphone };
  const permissions = createPermissions({
    platform,
    systemPreferences: {
      getMediaAccessStatus: (kind) => state[kind],
      askForMediaAccess: async (kind) => {
        calls.push(["prompt", kind]);
        state[kind] = grant ? "granted" : "denied";
        return grant;
      },
    },
    desktopCapturer: {
      getSources: async (options) => {
        calls.push(["sources", options]);
        if (grant) state.screen = "granted";
        return [{ id: "screen:test" }];
      },
    },
    shell: { openExternal: async (url) => calls.push(["settings", url]) },
  });
  return { permissions, calls, state };
}
test("macOS status checks do not prompt; microphone prompts only on a user request and not again after denial", async () => {
  const { permissions, calls } = fixture({ grant: false });
  assert.deepEqual(permissions.status(), {
    screen: "not-determined",
    microphone: "not-determined",
  });
  assert.deepEqual(calls, []);
  assert.equal((await permissions.request("microphone")).microphone, "denied");
  await permissions.request("microphone");
  assert.deepEqual(calls, [["prompt", "microphone"]]);
  await permissions.open("microphone");
  assert(calls.at(-1)[1].endsWith("Privacy_Microphone"));
});
test("screen consent uses native source enumeration, never the unsupported askForMediaAccess screen argument", async () => {
  const { permissions, calls } = fixture();
  assert.equal((await permissions.request("screen")).screen, "granted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "sources");
  assert.deepEqual(calls[0][1].types, ["screen"]);
  await permissions.open("screen");
  assert(calls.at(-1)[1].endsWith("Privacy_ScreenCapture"));
  await assert.rejects(
    () => permissions.request("camera"),
    /screen or microphone/,
  );
  await assert.rejects(
    () => permissions.open("https://example.com"),
    /screen or microphone/,
  );
});
test("macOS source enumeration refuses apparently available sources when Screen Recording is denied", async () => {
  const denied = fixture({ screen: "denied", grant: false });
  await assert.rejects(
    () => denied.permissions.listSources({ types: ["screen"] }),
    /Screen Recording access is required/,
  );
  const allowed = fixture({ screen: "granted" });
  assert.equal(
    (await allowed.permissions.listSources({ types: ["window"] }))[0].id,
    "screen:test",
  );
});
test("Windows does not invoke macOS prompt APIs or silently claim microphone access", async () => {
  const { permissions, calls } = fixture({
    platform: "win32",
    microphone: "denied",
    grant: false,
  });
  assert.deepEqual(await permissions.request("microphone"), {
    screen: "granted",
    microphone: "denied",
  });
  assert.deepEqual(calls, []);
  await permissions.open("microphone");
  assert.deepEqual(calls, [["settings", "ms-settings:privacy-microphone"]]);
});
test("permission policy allows main-frame display capture and microphone audio while denying camera and unrelated capabilities", () => {
  const main = { isMainFrame: true };
  assert(
    permissionRequestAllowed("display-capture", {
      ...main,
      mediaTypes: ["video", "audio"],
    }),
  );
  assert(permissionRequestAllowed("media", { ...main, mediaTypes: ["audio"] }));
  assert(
    !permissionRequestAllowed("media", { ...main, mediaTypes: ["video"] }),
  );
  assert(
    !permissionRequestAllowed("media", {
      ...main,
      mediaTypes: ["audio", "video"],
    }),
  );
  assert(!permissionRequestAllowed("media", main));
  assert(!permissionRequestAllowed("display-capture", { isMainFrame: false }));
  assert(!permissionRequestAllowed("geolocation", main));
  assert(permissionCheckAllowed("media", { ...main, mediaType: "audio" }));
  assert(!permissionCheckAllowed("media", { ...main, mediaType: "video" }));
  assert(!permissionCheckAllowed("notifications", main));
});
