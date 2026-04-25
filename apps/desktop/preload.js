import contextBridge from "electron";

contextBridge.exposeInMainWorld("templateMeta", {
  name: "Folo-Style Desktop Demo",
  platform: "electron"
});
