import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("host", {
  invoke: (command: string, payload: any) =>
    ipcRenderer.invoke("command", command, payload),
  onState: (cb: Function) => {
    const listener = (_e: any, state: any) => cb(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  },
  onFocusAddress: (cb: Function) => {
    const listener = () => cb();
    ipcRenderer.on("focus-address", listener);
    return () => ipcRenderer.removeListener("focus-address", listener);
  },
});
