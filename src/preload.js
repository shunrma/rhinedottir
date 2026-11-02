const { contextBridge, ipcRenderer } = require("electron");

// Every call resolves to the value, or throws with the main process's error message.
const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
};
const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("launcher", {
  init: () => call("app:init"),
  refresh: () => call("catalog:refresh"),
  login: () => call("account:login"),
  logout: () => call("account:logout"),
  setSettings: (patch) => call("settings:set", patch),
  setGitHubKey: (key) => call("github:set-key", key),
  install: (id) => call("pack:install", id),
  play: (id) => call("pack:play", id),
  openFolder: (id, folder) => call("pack:open-folder", id, folder),
  uninstall: (id) => call("pack:uninstall", id),
  dhStatus: (id) => call("dh:status", id),
  dhDownload: (id, level) => call("dh:download", id, level),
  openLink: (url) => call("link:open", url),
  minimize: () => call("window:minimize"),
  ready: () => call("window:ready"),
  close: () => call("window:close"),
  checkLauncherUpdate: () => call("launcher:check-update"),
  installLauncherUpdate: () => call("launcher:install-update"),
  onProgress: on("progress"),
  onBusy: on("busy"),
  onGameState: on("game-state"),
  onGameCrashed: on("game-crashed"),
  onLauncherUpdate: on("launcher-update"),
  onDhProgress: on("dh-progress"),
});
