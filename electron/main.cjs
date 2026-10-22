const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  session,
  dialog,
  clipboard,
  ClipboardItem,
  nativeImage,
  globalShortcut,
  Menu,
  shell,
  systemPreferences,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createWorkflow } = require("./workflow.cjs");
const { exportVideo } = require("./video-export.cjs");
const { CaptureStore, clampRect } = require("./store.cjs");
const { WindowsShortcut } = require("./windows-shortcut.cjs");
const {
  createPermissions,
  permissionRequestAllowed,
  permissionCheckAllowed,
} = require("./permissions.cjs");
const permissions = createPermissions({
  platform: process.platform,
  systemPreferences,
  desktopCapturer,
  shell,
});

const isDev = process.argv.includes("--dev");
if (process.env.FRAME_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.FRAME_DATA_DIR));
let mainWindow,
  overlay,
  regionData,
  selectedRecordingSource,
  store,
  recording = false,
  capturing = false;
let shortcuts = {};
let rendererReady = false,
  pendingCommands = [];
let windowsShortcut,
  workflow,
  quitting = false,
  quitAfterSave = false,
  exporting = 0,
  quitAfterExport = false;
const trusted = (event) =>
  mainWindow &&
  event.sender === mainWindow.webContents &&
  event.senderFrame === mainWindow.webContents.mainFrame;
const handle = (channel, callback) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error("Request denied.");
    return callback(...args);
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const command = (value) => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
  const quiet = [
    "snip",
    "quick-screen",
    "record-area",
    "stop-recording",
    "pause-recording",
    "shortcuts-changed",
  ].includes(value);
  // Window visibility is independent of renderer startup. Commands are delivered only
  // after React has installed its IPC listener, including a hidden background launch.
  if (!quiet) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (!rendererReady) {
    if (!pendingCommands.includes(value))
      pendingCommands = [...pendingCommands.slice(-7), value];
    return;
  }
  mainWindow.webContents.send("app:command", value);
};
async function selectArea(image, display) {
  regionData = image.toDataURL();
  return new Promise((resolve) => {
    const win = (overlay = new BrowserWindow({
      ...display.bounds,
      title: "Select capture area",
      frame: false,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#101216",
      webPreferences: {
        preload: path.join(__dirname, "overlay-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }));
    win.setMenu(null);
    win.setBounds(display.bounds);
    if (process.platform === "darwin") {
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    const finish = (event, r) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        return;
      if (
        r &&
        (!["x", "y", "width", "height"].every((k) => Number.isFinite(r[k])) ||
          r.x < 0 ||
          r.y < 0 ||
          r.width <= 0 ||
          r.height <= 0 ||
          r.x + r.width > 1.001 ||
          r.y + r.height > 1.001)
      )
        return;
      resolve(r);
      win.close();
    };
    const ready = (event) => {
      if (event.sender === win.webContents && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    };
    ipcMain.on("region:finish", finish);
    ipcMain.on("region:ready", ready);
    win.on("closed", () => {
      ipcMain.removeListener("region:finish", finish);
      ipcMain.removeListener("region:ready", ready);
      overlay = null;
      regionData = null;
      resolve(null);
    });
    win.loadFile(path.join(__dirname, "overlay.html")).catch(() => win.close());
  });
}
function currentSource(available, id) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return id === "cursor"
    ? available.find((s) => s.display_id === String(display.id))
    : available.find((s) => s.id === id);
}
async function copyImage(data) {
  if (
    typeof data !== "string" ||
    !data.startsWith("data:image/") ||
    data.length > 150000000
  )
    throw Error("Invalid clipboard image.");
  const img = nativeImage.createFromDataURL(data);
  if (img.isEmpty()) throw Error("Could not copy this image.");
  await clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([img.toPNG()], { type: "image/png" }),
    }),
  ]);
  return true;
}
async function exportFile(id, format, parent = mainWindow) {
  const item = store.get(id),
    image = item.kind === "image";
  const nativeFormat = item.mime === "video/mp4" ? "mp4" : "webm";
  const extension = image
    ? format === "jpg"
      ? "jpg"
      : "png"
    : ["mp4", "webm"].includes(format)
      ? format
      : nativeFormat;
  const options = {
    title: "Export capture",
    defaultPath: path.join(
      image ? app.getPath("pictures") : app.getPath("videos"),
      item.name + "." + extension,
    ),
    filters: [
      {
        name: image
          ? "Image"
          : extension === "mp4"
            ? "MP4 video"
            : "WebM video",
        extensions: [extension],
      },
    ],
  };
  const { canceled, filePath } = await dialog.showSaveDialog(parent, options);
  if (canceled || !filePath) return false;
  const normalize = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const destination = normalize(
    await fs
      .realpath(filePath)
      .catch(async () =>
        path.join(
          await fs.realpath(path.dirname(filePath)),
          path.basename(filePath),
        ),
      ),
  );
  const libraryRoot = normalize(await fs.realpath(store.root));
  if (
    destination === libraryRoot ||
    destination.startsWith(libraryRoot + path.sep)
  )
    throw Error("Choose a location outside Frame’s managed capture folder.");
  exporting++;
  try {
    if (image) {
      const img = nativeImage.createFromBuffer(
        await fs.readFile(store.file(id)),
      );
      await fs.writeFile(
        filePath,
        extension === "jpg" ? img.toJPEG(95) : img.toPNG(),
      );
    } else await exportVideo(store.file(id), filePath, extension, nativeFormat);
    return true;
  } finally {
    exporting--;
    if (quitAfterExport && !exporting && !recording) app.quit();
  }
}
function requestQuit() {
  if (recording) {
    quitAfterSave = true;
    command("stop-recording");
  } else if (exporting) quitAfterExport = true;
  else app.quit();
}
async function sources(type = "screen", full = false) {
  if (!["screen", "window"].includes(type))
    throw new Error("Choose a screen or window.");
  const displays = screen.getAllDisplays();
  const width = full
    ? Math.max(
        1920,
        ...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor)),
      )
    : 480;
  const height = full
    ? Math.max(
        1080,
        ...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor)),
      )
    : 300;
  return permissions.listSources({
    types: [type],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  });
}
async function capture({ mode, sourceId }) {
  if (capturing || recording)
    throw Error("Finish the current capture or recording first.");
  if (!["region", "screen", "window"].includes(mode))
    throw Error("Unknown capture mode.");
  capturing = true;
  const wasVisible = mainWindow.isVisible();
  try {
    workflow?.hidePreviews();
    if (wasVisible) mainWindow.hide();
    await pause(140);
    const available = await sources(
      mode === "window" ? "window" : "screen",
      true,
    );
    const found = currentSource(available, sourceId);
    if (!found || found.thumbnail.isEmpty())
      throw Error(
        "Capture source unavailable. On macOS, allow Screen Recording in System Settings.",
      );
    let image = found.thumbnail;
    if (mode === "region") {
      const display =
        screen
          .getAllDisplays()
          .find((d) => String(d.id) === found.display_id) ||
        screen.getPrimaryDisplay();
      const rect = await selectArea(image, display);
      if (!rect) {
        if (wasVisible) mainWindow.show();
        workflow.restorePreviews();
        return null;
      }
      const size = image.getSize();
      image = image.crop(
        clampRect(
          {
            x: rect.x * size.width,
            y: rect.y * size.height,
            width: rect.width * size.width,
            height: rect.height * size.height,
          },
          size,
        ),
      );
    }
    return { data: image.toDataURL(), ...image.getSize() };
  } catch (error) {
    if (wasVisible) mainWindow.show();
    workflow.restorePreviews();
    throw error;
  } finally {
    capturing = false;
    workflow.restorePreviews(true);
  }
}
async function prepareRecording(sourceId, area) {
  if (recording || capturing) throw Error("Finish the current capture first.");
  const wasVisible = mainWindow.isVisible();
  mainWindow.hide();
  workflow?.hidePreviews();
  try {
    await pause(140);
    const found = currentSource(
      await sources(
        area ? "screen" : sourceId.startsWith("window:") ? "window" : "screen",
        !!area,
      ),
      sourceId,
    );
    if (!area) {
      workflow.context({
        kind: sourceId.startsWith("window:") ? "window" : "screen",
        displayId: found?.display_id,
      });
      return { sourceId };
    }
    if (!found || found.thumbnail.isEmpty()) throw Error("Screen unavailable.");
    const display =
      screen.getAllDisplays().find((d) => String(d.id) === found.display_id) ||
      screen.getPrimaryDisplay();
    capturing = true;
    const rect = await selectArea(found.thumbnail, display);
    if (!rect) {
      if (wasVisible) mainWindow.show();
      workflow.restorePreviews();
      return null;
    }
    workflow.context({ kind: "screen", displayId: found.display_id, rect });
    return { sourceId: found.id, rect };
  } catch (error) {
    if (wasVisible) mainWindow.show();
    workflow.restorePreviews();
    throw error;
  } finally {
    capturing = false;
  }
}
function createWindow(show = true) {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false,
    minWidth: 900,
    minHeight: 640,
    title: "Frame",
    icon: path.join(__dirname, "../assets/icon.png"),
    backgroundColor: "#f9fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.setContentProtection(true);
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (show && !process.argv.includes("--background")) mainWindow.show();
  });
  mainWindow.on("closed", () => {
    rendererReady = false;
    mainWindow = null;
  });
  if (isDev) mainWindow.loadURL("http://127.0.0.1:5173");
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}
const ownsProfile = !!process.env.FRAME_TEST || app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on("second-instance", () => command("show"));
if (ownsProfile)
  app
    .whenReady()
    .then(async () => {
      store = new CaptureStore(path.join(app.getPath("userData"), "captures"));
      await store.init();
      if (process.platform === "win32") {
        windowsShortcut = new WindowsShortcut({
          executable: app.isPackaged
            ? path.join(
                process.resourcesPath,
                "app.asar.unpacked/assets/native/FrameShortcutHost.exe",
              )
            : path.join(__dirname, "../assets/native/FrameShortcutHost.exe"),
          preferenceFile: path.join(
            app.getPath("userData"),
            "windows-shortcut.json",
          ),
          defaultEnabled: !process.env.FRAME_TEST,
          onCapture: () => {
            if (!capturing) command("snip");
          },
          onChange: () => {
            if (mainWindow && !mainWindow.isDestroyed())
              mainWindow.webContents.send("app:command", "shortcuts-changed");
          },
        });
        await windowsShortcut.init();
      }
      workflow = createWorkflow({
        store,
        command,
        copy: copyImage,
        exportFile,
        quit: requestQuit,
      });
      workflow.init();
      if (process.env.FRAME_TEST) global.frameWorkflow = workflow;
      createWindow();
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) =>
          callback(
            contents === mainWindow?.webContents &&
              permissionRequestAllowed(permission, details),
          ),
      );
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, _origin, details) =>
          contents === mainWindow?.webContents &&
          permissionCheckAllowed(permission, details),
      );
      session.defaultSession.setDisplayMediaRequestHandler(
        async (request, callback) => {
          try {
            if (
              request.frame !== mainWindow.webContents.mainFrame ||
              !selectedRecordingSource
            )
              return callback({});
            const selected = selectedRecordingSource;
            selectedRecordingSource = null;
            const source = (
              await permissions.listSources({
                types: ["screen", "window"],
                thumbnailSize: { width: 0, height: 0 },
              })
            ).find((s) => s.id === selected.id);
            if (!source) return callback({});
            callback({
              video: source,
              ...(request.audioRequested &&
              selected.audio &&
              process.platform === "win32"
                ? { audio: "loopback" }
                : {}),
            });
          } catch {
            callback({});
          }
        },
      );
      handle("app:renderer-ready", () => {
        rendererReady = true;
        const queued = pendingCommands;
        pendingCommands = [];
        for (const value of queued)
          mainWindow.webContents.send("app:command", value);
      });
      handle("app:info", () => ({
        platform: process.platform,
        version: app.getVersion(),
        storagePath: store.root,
        shortcuts,
        snippingShortcut: windowsShortcut
          ? { ...windowsShortcut.status }
          : undefined,
        screenPermission: permissions.status().screen,
        microphonePermission: permissions.status().microphone,
      }));
      handle("app:snipping-shortcut", (enabled) => {
        if (!windowsShortcut)
          throw new Error("This shortcut is available only on Windows.");
        return windowsShortcut.setEnabled(enabled);
      });
      handle("app:request-permission", (kind) => permissions.request(kind));
      handle("capture:list", () => store.list());
      handle("capture:read", (id) => store.read(id));
      handle("capture:project", async (id) => {
        const p = await store.project(id);
        return p ? { ...p, image: await store.read(p.sourceId, true) } : null;
      });
      handle("capture:present", (id) => {
        store.get(id);
        workflow.preview(id);
      });
      handle("app:hide", () => mainWindow.hide());
      handle("screen:prepare", prepareRecording);
      handle("capture:save", (input) => store.add(input));
      handle("capture:update", (id, patch) => store.update(id, patch));
      handle("screen:sources", async (type) =>
        (await sources(type))
          .filter(
            (s) =>
              !BrowserWindow.getAllWindows()
                .filter(
                  (w) =>
                    w === mainWindow || w === overlay || workflow.ownsWindow(w),
                )
                .some((w) =>
                  s.id.startsWith(
                    `window:${w.getMediaSourceId().split(":")[1]}:`,
                  ),
                ),
          )
          .map((s) => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
            displayId: s.display_id,
          })),
      );
      handle("screen:capture", capture);
      handle("screen:recording-source", (id, audio) => {
        if (typeof id !== "string" || !/^(screen|window):/.test(id))
          throw new Error("Choose a capture source.");
        selectedRecordingSource = { id, audio: !!audio };
      });
      handle("screen:recording-state", (value) => {
        const state =
          typeof value === "boolean"
            ? { state: value ? "recording" : "idle", seconds: 0 }
            : value;
        if (
          !state ||
          !["idle", "preparing", "recording", "paused", "saving"].includes(
            state.state,
          ) ||
          !Number.isFinite(state.seconds) ||
          state.seconds < 0
        )
          throw Error("Invalid recording state.");
        const wasRecording = recording;
        recording = state.state !== "idle";
        if (recording && !wasRecording) mainWindow.hide();
        workflow.state({
          state: state.state,
          seconds: Math.floor(state.seconds),
        });
        if (!recording && quitAfterSave) app.quit();
      });
      handle("capture:export", (id, format) => exportFile(id, format));
      handle("capture:copy", copyImage);
      handle("capture:reveal", (id) => shell.showItemInFolder(store.file(id)));
      handle("app:folder", () => shell.openPath(store.root));
      handle("app:permissions", (kind) => permissions.open(kind));
      ipcMain.handle("region:image", (event) =>
        event.sender === overlay?.webContents ? regionData : null,
      );
      if (!process.env.FRAME_TEST) {
        shortcuts.region = globalShortcut.register(
          "CommandOrControl+Shift+2",
          () => command("snip"),
        );
        shortcuts.screen = globalShortcut.register(
          process.platform === "darwin" ? "Command+Shift+1" : "Control+Shift+3",
          () => command("quick-screen"),
        );
        shortcuts.record = globalShortcut.register(
          "CommandOrControl+Shift+9",
          () => command(recording ? "stop-recording" : "record"),
        );
      }
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin"
            ? [
                {
                  label: "Frame",
                  submenu: [
                    { role: "about" },
                    { type: "separator" },
                    { role: "quit" },
                  ],
                },
              ]
            : []),
          {
            label: "File",
            submenu: [
              { label: "Capture area", click: () => command("region") },
              { label: "Capture screen", click: () => command("screen") },
              { label: "Record screen", click: () => command("record") },
              { type: "separator" },
              {
                label: "Import image",
                accelerator: "CommandOrControl+O",
                click: () => command("import"),
              },
              ...(process.platform !== "darwin" ? [{ role: "quit" }] : []),
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
              ...(isDev ? [{ role: "toggleDevTools" }] : []),
            ],
          },
          {
            label: "Window",
            submenu: [{ role: "minimize" }, { role: "zoom" }],
          },
        ]),
      );
      app.on("activate", () => command("library"));
    })
    .catch((error) => {
      dialog.showErrorBox("Frame could not start", error.message);
      app.quit();
    });
app.on("before-quit", (event) => {
  if (recording || exporting) {
    event.preventDefault();
    requestQuit();
  } else quitting = true;
});
app.on("will-quit", () => {
  workflow?.dispose();
  windowsShortcut?.dispose();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
