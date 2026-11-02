// Launcher self-update from the public Rhinedottir repo's GitHub releases. Only
// launcher installers are released there (pack files live in the repo itself), so
// the newest release is always the newest launcher.
const { app } = require("electron");
const config = require("./config");

let autoUpdater = null;
let send = () => {};

function init(options) {
  send = options.send;
  // Only installed builds can update themselves.
  if (!app.isPackaged) return;
  ({ autoUpdater } = require("electron-updater"));
  const [owner, repo] = config.launcherRepo.split("/");
  autoUpdater.setFeedURL({ provider: "github", owner, repo });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => send("launcher-update", { version: info.version }));
  autoUpdater.on("error", (err) => console.error("launcher update failed", err));
  check().catch(() => {});
}

async function check() {
  if (!autoUpdater) return { available: false };
  const result = await autoUpdater.checkForUpdates();
  const latest = result?.updateInfo?.version;
  return { available: !!latest && latest !== app.getVersion(), version: latest };
}

// Restarts into the downloaded update.
function install() {
  if (autoUpdater) autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, install };
