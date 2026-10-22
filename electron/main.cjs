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
let windowsShortcut;
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow.webContents.once("did-finish-load", () => command(value));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("app:command", value);
};

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
  if (capturing) throw new Error("A capture is already in progress.");
  if (recording)
    throw new Error("Stop the recording before taking a screenshot.");
  if (!["region", "screen", "window"].includes(mode))
    throw new Error("Unknown capture mode.");
  capturing = true;
  try {
    mainWindow.hide();
    await pause(280);
    const available = await sources(
      mode === "window" ? "window" : "screen",
      true,
    );
    const cursorDisplay =
      mode === "region" && sourceId === "cursor"
        ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        : null;
    const found = cursorDisplay
      ? available.find((s) => s.display_id === String(cursorDisplay.id))
      : available.find((s) => s.id === sourceId);
    if (!found || found.thumbnail.isEmpty())
      throw new Error(
        "That source is unavailable. On macOS, allow Screen Recording in System Settings, then restart Frame.",
      );
    let image = found.thumbnail;
    if (mode === "region") {
      const display =
        screen
          .getAllDisplays()
          .find((d) => String(d.id) === found.display_id) ||
        screen.getPrimaryDisplay();
      regionData = image.toDataURL();
      const rect = await new Promise((resolve) => {
        overlay = new BrowserWindow({
          ...display.bounds,
          frame: false,
          resizable: false,
          movable: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          fullscreen: process.platform === "darwin",
          backgroundColor: "#101216",
          webPreferences: {
            preload: path.join(__dirname, "overlay-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        overlay.setMenuBarVisibility(false);
        const finish = (event, r) => {
          if (event.sender === overlay?.webContents) {
            resolve(r);
            overlay.close();
          }
        };
        ipcMain.on("region:finish", finish);
        overlay.on("closed", () => {
          ipcMain.removeListener("region:finish", finish);
          overlay = null;
          regionData = null;
          resolve(null);
        });
        overlay.loadFile(path.join(__dirname, "overlay.html"));
      });
      if (!rect) return null;
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
    const size = image.getSize();
    return { data: image.toDataURL(), ...size };
  } finally {
    capturing = false;
    mainWindow.show();
    mainWindow.focus();
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
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
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.on("close", (event) => {
    if (recording) {
      event.preventDefault();
      command("stop-recording");
    }
  });
  mainWindow.on("closed", () => {
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
      handle("capture:save", (input) => store.add(input));
      handle("capture:update", (id, patch) => store.update(id, patch));
      handle("screen:sources", async (type) =>
        (await sources(type))
          .filter(
            (s) =>
              !s.id.startsWith(
                `window:${mainWindow.getMediaSourceId().split(":")[1]}:`,
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
      handle("screen:recording-state", (state) => {
        recording = !!state;
        if (recording) mainWindow.minimize();
        else mainWindow.show();
      });
      handle("capture:export", async (id, format) => {
        const item = store.get(id);
        const image = item.kind === "image";
        if (image && !["png", "jpg"].includes(format)) format = "png";
        const extension = image
          ? format
          : item.mime === "video/mp4"
            ? "mp4"
            : "webm";
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
          title: "Export capture",
          defaultPath: path.join(
            app.getPath("pictures"),
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
        });
        if (canceled || !filePath) return false;
        let data = await fs.readFile(store.file(id));
        if (image) {
          const img = nativeImage.createFromBuffer(data);
          data = extension === "jpg" ? img.toJPEG(95) : img.toPNG();
        }
        await fs.writeFile(filePath, data);
        return true;
      });
      handle("capture:copy", async (data) => {
        if (
          typeof data !== "string" ||
          !data.startsWith("data:image/") ||
          data.length > 150000000
        )
          throw new Error("Invalid clipboard image.");
        const img = nativeImage.createFromDataURL(data);
        if (img.isEmpty()) throw new Error("Could not copy this image.");
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([img.toPNG()], { type: "image/png" }),
          }),
        ]);
        return true;
      });
      handle("capture:reveal", (id) => shell.showItemInFolder(store.file(id)));
      handle("app:folder", () => shell.openPath(store.root));
      handle("app:permissions", (kind) => permissions.open(kind));
      ipcMain.handle("region:image", (event) =>
        event.sender === overlay?.webContents ? regionData : null,
      );
      if (!process.env.FRAME_TEST) {
        shortcuts.region = globalShortcut.register(
          "CommandOrControl+Shift+2",
          () => command("region"),
        );
        shortcuts.screen = globalShortcut.register(
          process.platform === "darwin" ? "Command+Shift+1" : "Control+Shift+3",
          () => command("screen"),
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
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox("Frame could not start", error.message);
      app.quit();
    });
app.on("will-quit", () => {
  windowsShortcut?.dispose();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
