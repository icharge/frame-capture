const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("region", {
  image: () => ipcRenderer.invoke("region:image"),
  finish: (rect) => ipcRenderer.send("region:finish", rect),
  cancel: () => ipcRenderer.send("region:finish", null),
});
