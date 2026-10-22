const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("region", {
  ready: () => ipcRenderer.send("region:ready"),
  image: () => ipcRenderer.invoke("region:image"),
  finish: (rect) => ipcRenderer.send("region:finish", rect),
  cancel: () => ipcRenderer.send("region:finish", null),
});
