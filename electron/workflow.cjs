const {
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
} = require("electron");
const path = require("node:path");
function createWorkflow({ store, command, copy, exportFile, quit }) {
  let tray,
    menu,
    bar,
    lastState = { state: "idle", seconds: 0 },
    menuState = "";
  const windows = new Map();
  let context = {};
  const secure = (w) => {
    w.setMenu(null);
    w.setContentProtection(true);
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (event) => event.preventDefault());
    w.webContents.on("will-attach-webview", (event) => event.preventDefault());
    if (process.platform === "darwin")
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  };
  const trusted = (event) =>
    [...windows.keys()].find(
      (w) =>
        !w.isDestroyed() &&
        w.webContents === event.sender &&
        event.senderFrame === w.webContents.mainFrame,
    );
  const send = (w) => {
    if (w && !w.isDestroyed()) w.webContents.send("float:update");
  };
  function create(data, size) {
    const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      ),
      area = display.workArea;
    const win = new BrowserWindow({
      title: data.kind === "recorder" ? "Frame recorder" : "Capture preview",
      width: size.width,
      height: size.height,
      x: area.x + area.width - size.width - 24,
      y: area.y + area.height - size.height - 24,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: data.kind !== "recorder",
      show: false,
      backgroundColor: "#f9fafc",
      webPreferences: {
        preload: path.join(__dirname, "floating-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    windows.set(win, data);
    secure(win);
    win.on("closed", () => {
      windows.delete(win);
      if (bar === win) bar = null;
    });
    win.loadFile(path.join(__dirname, "floating.html"));
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    return win;
  }
  function updateTray() {
    if (!tray) return;
    tray.setToolTip(
      lastState.state === "idle"
        ? "Frame · ready to capture"
        : `Frame · ${lastState.state} · ${Math.floor(lastState.seconds / 60)}:${String(lastState.seconds % 60).padStart(2, "0")}`,
    );
    if (menuState === lastState.state) return;
    menuState = lastState.state;
    const active = lastState.state !== "idle";
    menu = Menu.buildFromTemplate([
      { id: "show", label: "Open library", click: () => command("library") },
      { type: "separator" },
      {
        id: "area",
        label: "Capture area",
        enabled: !active,
        click: () => command("snip"),
      },
      {
        id: "screen",
        label: "Capture screen",
        enabled: !active,
        click: () => command("quick-screen"),
      },
      {
        id: "window",
        label: "Capture window…",
        enabled: !active,
        click: () => command("window"),
      },
      { type: "separator" },
      {
        id: "record-area",
        label: "Record area",
        enabled: !active,
        click: () => command("record-area"),
      },
      {
        id: "record",
        label: "Record screen or window…",
        enabled: !active,
        click: () => command("record"),
      },
      ...(active
        ? [
            {
              id: "pause",
              label:
                lastState.state === "paused"
                  ? "Resume recording"
                  : "Pause recording",
              enabled: ["recording", "paused"].includes(lastState.state),
              click: () => command("pause-recording"),
            },
            {
              id: "stop",
              label:
                lastState.state === "preparing"
                  ? "Cancel recording"
                  : "Stop recording",
              enabled: ["recording", "paused", "preparing"].includes(
                lastState.state,
              ),
              click: () => command("stop-recording"),
            },
            {
              id: "controls",
              label: "Show recorder controls",
              click: () => {
                if (bar) bar.showInactive();
              },
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "Open capture folder",
        click: () => require("electron").shell.openPath(store.root),
      },
      {
        id: "quit",
        label: active ? "Stop recording and quit" : "Quit Frame",
        click: quit,
      },
    ]);
    tray.setContextMenu(menu);
  }
  function init() {
    let image;
    if (process.platform === "darwin") {
      const pixels = Buffer.alloc(16 * 16 * 4);
      for (let y = 2; y < 14; y++)
        for (let x = 2; x < 14; x++)
          if (
            ((x < 4 || x > 11) && (y < 6 || y > 9)) ||
            ((y < 4 || y > 11) && (x < 6 || x > 9))
          )
            pixels[(y * 16 + x) * 4 + 3] = 255;
      image = nativeImage.createFromBitmap(pixels, {
        width: 16,
        height: 16,
        scaleFactor: 1,
      });
      image.setTemplateImage(true);
    } else image = path.join(__dirname, "../assets/icon.ico");
    tray = new Tray(image);
    tray.on("double-click", () => command("library"));
    updateTray();
  }
  ipcMain.handle("float:data", async (event) => {
    const w = trusted(event);
    if (!w) throw Error("Request denied.");
    const d = windows.get(w);
    if (d.kind === "recorder") return { ...lastState, kind: "recorder" };
    const item = store.get(d.id);
    return {
      kind: "preview",
      name: item.name,
      image:
        item.kind === "image"
          ? "data:" + item.mime + ";base64," + (await store.read(item.id)).data
          : item.thumbnail,
      video: item.kind === "video",
      format: item.mime === "video/mp4" ? "mp4" : "webm",
      pinned: !!d.pinned,
    };
  });
  ipcMain.handle("float:action", async (event, action) => {
    const w = trusted(event);
    if (!w) throw Error("Request denied.");
    const data = windows.get(w);
    if (data.kind === "recorder") {
      if (action === "pause") command("pause-recording");
      else if (action === "stop") command("stop-recording");
      else if (action === "hide") w.hide();
      else throw Error("Unknown recorder action.");
      return true;
    }
    const item = store.get(data.id);
    if (action === "close") {
      w.close();
      return true;
    }
    if (action === "edit") {
      command("open:" + item.id);
      w.close();
      return true;
    }
    if (action === "copy") {
      if (item.kind !== "image") throw Error("Only images can be copied.");
      await copy(
        "data:" + item.mime + ";base64," + (await store.read(item.id)).data,
      );
      return true;
    }
    if (
      action === "export" ||
      (item.kind === "video" && ["export:mp4", "export:webm"].includes(action))
    )
      return exportFile(
        item.id,
        item.kind === "image"
          ? "png"
          : action.startsWith("export:")
            ? action.slice(7)
            : item.mime === "video/mp4"
              ? "mp4"
              : "webm",
        w,
      );
    if (action === "pin") {
      data.pinned = !data.pinned;
      w.setSize(data.pinned ? 560 : 320, data.pinned ? 400 : 270);
      send(w);
      return true;
    }
    throw Error("Unknown capture action.");
  });
  return {
    init,
    ownsWindow: (win) => windows.has(win),
    preview(id) {
      for (const [w, d] of windows)
        if (d.kind === "preview" && !d.pinned) w.close();
      return create({ kind: "preview", id }, { width: 320, height: 270 });
    },
    restorePreviews(pinnedOnly = false) {
      for (const [win, d] of windows)
        if (
          d.kind === "preview" &&
          (!pinnedOnly || d.pinned) &&
          !win.isDestroyed()
        )
          win.showInactive();
    },
    hidePreviews() {
      for (const [w, d] of windows) if (d.kind === "preview") w.hide();
    },
    context(value) {
      context = value;
    },
    state(value) {
      lastState = value;
      if (value.state === "idle") {
        bar?.close();
        bar = null;
        for (const [win, d] of windows)
          if (d.kind === "preview" && d.pinned) win.showInactive();
      } else if (!bar) {
        let position;
        if (process.platform === "darwin" && context.kind !== "window") {
          const display = screen
            .getAllDisplays()
            .find((d) => String(d.id) === context.displayId);
          const other = screen
            .getAllDisplays()
            .find((d) => String(d.id) !== context.displayId);
          if (other)
            position = { x: other.workArea.x + 16, y: other.workArea.y + 16 };
          else if (display && context.rect) {
            const a = display.workArea,
              b = display.bounds,
              r = context.rect;
            const crop = {
              x: b.x + r.x * b.width,
              y: b.y + r.y * b.height,
              width: r.width * b.width,
              height: r.height * b.height,
            };
            const candidates = [
              { x: a.x + 16, y: a.y + 16 },
              { x: a.x + a.width - 358, y: a.y + 16 },
              { x: a.x + 16, y: a.y + a.height - 80 },
              { x: a.x + a.width - 358, y: a.y + a.height - 80 },
            ];
            position = candidates.find(
              (p) =>
                p.x >= a.x &&
                p.y >= a.y &&
                p.x + 342 <= a.x + a.width &&
                p.y + 64 <= a.y + a.height &&
                (p.x + 350 < crop.x ||
                  p.x > crop.x + crop.width + 8 ||
                  p.y + 72 < crop.y ||
                  p.y > crop.y + crop.height + 8),
            );
          }
        }
        // On macOS a screen overlay must remain outside the captured pixels:
        // ScreenCaptureKit ignores NSWindowSharingNone. Otherwise use menu-bar controls.
        if (
          process.platform !== "darwin" ||
          context.kind === "window" ||
          position
        ) {
          bar = create({ kind: "recorder" }, { width: 342, height: 64 });
          if (position)
            bar.setPosition(Math.round(position.x), Math.round(position.y));
          if (process.platform === "darwin") bar.setMovable(false);
        }
      } else send(bar);
      updateTray();
    },
    dispose() {
      for (const w of windows.keys()) w.destroy();
      tray?.destroy();
    },
    // Internal entry points also let desktop tests exercise real menu callbacks.
    menuItem(id) {
      return menu?.getMenuItemById(id);
    },
    get tray() {
      return tray;
    },
    get bar() {
      return bar;
    },
  };
}
module.exports = { createWorkflow };
