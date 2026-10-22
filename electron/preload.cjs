const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("frame", {
  info: () => ipcRenderer.invoke("app:info"),
  setSnippingShortcut: (enabled) =>
    ipcRenderer.invoke("app:snipping-shortcut", enabled),
  list: () => ipcRenderer.invoke("capture:list"),
  read: (id) => ipcRenderer.invoke("capture:read", id),
  save: (input) => ipcRenderer.invoke("capture:save", input),
  update: (id, patch) => ipcRenderer.invoke("capture:update", id, patch),
  sources: (type) => ipcRenderer.invoke("screen:sources", type),
  screenshot: (input) => ipcRenderer.invoke("screen:capture", input),
  recordingSource: (id, audio) =>
    ipcRenderer.invoke("screen:recording-source", id, audio),
  recordingState: (state) =>
    ipcRenderer.invoke("screen:recording-state", state),
  exportFile: (id, format) => ipcRenderer.invoke("capture:export", id, format),
  copyImage: (data) => ipcRenderer.invoke("capture:copy", data),
  reveal: (id) => ipcRenderer.invoke("capture:reveal", id),
  openFolder: () => ipcRenderer.invoke("app:folder"),
  openPermissions: (kind) => ipcRenderer.invoke("app:permissions", kind),
  requestPermission: (kind) =>
    ipcRenderer.invoke("app:request-permission", kind),
  onCommand: (callback) => {
    const listener = (_, command) => callback(command);
    ipcRenderer.on("app:command", listener);
    return () => ipcRenderer.removeListener("app:command", listener);
  },
});
