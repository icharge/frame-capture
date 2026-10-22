const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("floating", {
  data: () => ipcRenderer.invoke("float:data"),
  action: (value) => ipcRenderer.invoke("float:action", value),
  onUpdate: (callback) => {
    const fn = () => callback();
    ipcRenderer.on("float:update", fn);
    return () => ipcRenderer.removeListener("float:update", fn);
  },
});
