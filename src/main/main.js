const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, session } = require("electron");
const config = require("./config");
const { makePaths } = require("./paths");
const { Settings } = require("./settings");
const { createGitHub } = require("./github");
const { Account } = require("./auth");
const { loadCatalog } = require("./packs");
const { planSync, applySync, readInstalled } = require("./sync");
const { ensureGame, launchGame, latestNeoForge, offlineProfile } = require("./game");
const os = require("node:os");
const { dhStatus, downloadDh } = require("./dh");
const { getVersionList } = require("@xmcl/installer");
const updater = require("./updater");

const paths = makePaths(app.getPath("appData"));
let gh;
let settings;
let account;
let win;
let catalog = { packs: [], offline: false };
let busy = null; // pack id currently installing or running
let dhBusy = false;
const OPENABLE = ["Distant_Horizons_server_data", "screenshots", "resourcepacks"];

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function findPack(id) {
  const pack = catalog.packs.find((p) => p.id === id);
  if (!pack) throw new Error(`Unknown pack: ${id}`);
  return pack;
}

function packStatus(pack) {
  const installed = readInstalled(paths.instance(pack.id));
  let state;
  if (!pack.version) state = "unpublished";
  else if (!installed) state = "not-installed";
  else if (installed.version !== pack.version) state = "update";
  else state = "ready";
  return { state, installedVersion: installed?.version || null, latestVersion: pack.version };
}

// Strips the file list before sending a pack to the window.
function publicPack(pack) {
  const { files, ...rest } = pack;
  return { ...rest, status: packStatus(pack) };
}

async function refreshCatalog() {
  catalog = await loadCatalog(gh, config.packsRepo, paths.cache, {
    latestRelease: async () => (await getVersionList()).latest.release,
  });
  if (config.devMode) await devPacks();
  return {
    packs: catalog.packs.map(publicPack),
    offline: catalog.offline,
    error: catalog.error || null,
  };
}

// The GitHub key: the one baked into the build, or one the player pasted into Settings
// (kept encrypted with Windows' own protection).
function savedGitHubKey() {
  const enc = settings.get("githubKeyEnc");
  if (!enc || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  } catch {
    return "";
  }
}

// Packs and their files always come from GitHub. The Rhinedottir repo is public, so no
// key is needed; a baked-in or saved key is still used if there is one.
function connectRepo() {
  gh = createGitHub({ token: config.githubToken || savedGitHubKey(), api: config.githubApi });
}

async function setGitHubKey(key) {
  key = String(key || "").trim();
  if (!key) {
    settings.set({ githubKeyEnc: null });
  } else {
    // Make sure the key can read the packs before saving it.
    try {
      await createGitHub({ token: key, api: config.githubApi }).json(config.packsRepo, "packs.json");
    } catch (err) {
      throw new Error(
        err.status === 401 || err.status === 404 || err.status === 403
          ? "That key can't read the Rhinedottir repo. Check it has read access to it."
          : `Couldn't check the key: ${err.message}`,
      );
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't store the key securely on this PC.");
    settings.set({ githubKeyEnc: safeStorage.encryptString(key).toString("base64") });
  }
  connectRepo();
  return refreshCatalog();
}

// In a dev build a modded pack that was never published still installs: plain
// Minecraft with the newest NeoForge for its version, without the pack's files.
async function devPacks() {
  for (const pack of catalog.packs) {
    if (!pack.loader || pack.version) continue;
    if (!pack.neoforge) {
      try {
        pack.neoforge = await latestNeoForge(pack.minecraft);
      } catch (err) {
        console.error(err); // stays "Coming soon" until NeoForge's site can be reached
        continue;
      }
    }
    pack.version = "dev";
    pack.files = { version: "dev", minecraft: pack.minecraft, files: [] };
  }
}

// Offline player name for dev builds: the Windows user name, cleaned up to what Minecraft allows.
function devPlayerName() {
  const name = (os.userInfo().username || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  return name.length >= 3 ? name : "Player";
}

// Settings as the window sees them: never the key itself.
function publicSettings() {
  const { githubKeyEnc, ...rest } = settings.all();
  return { ...rest, hasGitHubKey: !!config.githubToken || !!githubKeyEnc, githubKeyBaked: !!config.githubToken };
}

function gameStateFile(packId) {
  return path.join(paths.instance(packId), ".createmotion", "game.json");
}

async function installPack(pack) {
  const instanceDir = paths.instance(pack.id);
  const progress = (p) => send("progress", { packId: pack.id, ...p });

  const game = await ensureGame(
    { minecraftDir: paths.minecraft, runtimesDir: paths.runtimes, minecraft: pack.minecraft, neoforge: pack.neoforge },
    progress,
  );
  fs.mkdirSync(path.dirname(gameStateFile(pack.id)), { recursive: true });
  fs.writeFileSync(gameStateFile(pack.id), JSON.stringify(game));

  progress({ label: "Checking pack files", fraction: 0 });
  const plan = await planSync(instanceDir, pack.files, readInstalled(instanceDir));
  await applySync(instanceDir, pack.files, plan, (f, dest, onBytes) =>
    gh.downloadFile(config.packsRepo, `packs/${pack.id}/files/${f.path}`, dest, onBytes), ({ done, total }) =>
    progress({ label: "Downloading pack files", fraction: total ? done / total : 1 }),
  );
}

async function withBusy(packId, fn) {
  if (busy) throw new Error("Something is already running. Please wait for it to finish.");
  busy = packId;
  send("busy", busy);
  try {
    return await fn();
  } finally {
    busy = null;
    send("busy", null);
  }
}

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        console.error(channel, err);
        return { ok: false, error: err.message || String(err) };
      }
    });

  // Returns straight away; the window loads the pack list right after.
  handle("app:init", async () => ({
    version: app.getVersion(),
    devMode: config.devMode,
    account: config.devMode ? null : account.summary(),
    settings: publicSettings(),
  }));
  handle("catalog:refresh", refreshCatalog);

  handle("account:login", () => account.login(win));
  handle("account:logout", () => account.logout());

  handle("settings:set", (patch) => {
    const clean = {};
    if (patch.memoryGB !== undefined) clean.memoryGB = Math.min(32, Math.max(2, Number(patch.memoryGB) || 4));
    if (patch.lastPack !== undefined) clean.lastPack = String(patch.lastPack);
    if (patch.sounds !== undefined) clean.sounds = !!patch.sounds;
    settings.set(clean);
    return publicSettings();
  });
  handle("github:set-key", setGitHubKey);

  handle("pack:install", (id) =>
    withBusy(id, async () => {
      await installPack(findPack(id));
      return publicPack(findPack(id));
    }),
  );

  handle("pack:play", (id) =>
    withBusy(id, async () => {
      const pack = findPack(id);
      if (packStatus(pack).state !== "ready") await installPack(pack);
      if (!fs.existsSync(gameStateFile(id))) await installPack(pack);
      const game = JSON.parse(fs.readFileSync(gameStateFile(id), "utf8"));
      let sessionData;
      if (config.devMode) sessionData = { profile: offlineProfile(devPlayerName()), accessToken: "0" };
      else {
        send("progress", { packId: id, label: "Signing in", fraction: 1 });
        sessionData = await account.getSession();
      }
      send("progress", { packId: id, label: "Starting Minecraft", fraction: 1 });
      const proc = await launchGame({
        minecraftDir: paths.minecraft,
        instanceDir: paths.instance(id),
        versionId: game.versionId,
        javaPath: game.javaPath,
        session: sessionData,
        memoryGB: settings.get("memoryGB"),
        offline: config.devMode,
      });
      send("game-state", { packId: id, running: true });
      let stderr = "";
      proc.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      win.minimize();
      await new Promise((resolve) => proc.on("exit", resolve).on("error", resolve));
      send("game-state", { packId: id, running: false });
      if (proc.exitCode) send("game-crashed", { packId: id, code: proc.exitCode, log: stderr });
      if (!win.isDestroyed()) win.restore();
      return publicPack(pack);
    }),
  );

  handle("pack:open-folder", (id, folder) => {
    findPack(id);
    if (!OPENABLE.includes(folder)) throw new Error(`Can't open ${folder}`);
    const dir = path.join(paths.instance(id), folder);
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  handle("dh:status", (id) => dhStatus(findPack(id), paths.instance(id)));

  handle("dh:download", async (id, levelId) => {
    const pack = findPack(id);
    if (busy === id) throw new Error("Close Minecraft and wait for other tasks to finish first.");
    if (dhBusy) throw new Error("A Distant Horizons download is already running.");
    dhBusy = true;
    try {
      return await downloadDh({ gh, repo: config.packsRepo, pack, instanceDir: paths.instance(id), levelId }, (p) => send("dh-progress", p));
    } finally {
      dhBusy = false;
    }
  });

  handle("pack:uninstall", async (id) => {
    const pack = findPack(id);
    if (busy) throw new Error("Wait for the current task to finish first.");
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Uninstall", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Uninstall",
      message: `Uninstall ${pack.name}?`,
      detail: "This deletes the pack, including your worlds, screenshots and settings for it.",
    });
    if (response !== 0) return publicPack(pack);
    fs.rmSync(paths.instance(id), { recursive: true, force: true });
    return publicPack(pack);
  });

  handle("link:open", (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error("Only https links can be opened.");
    return shell.openExternal(url);
  });

  handle("window:minimize", () => win.minimize());
  handle("window:close", () => win.close());
  handle("launcher:check-update", () => updater.check());
  handle("launcher:install-update", () => updater.install());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 640,
    resizable: false,
    maximizable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    title: "Rhine Launcher",
    icon: path.join(__dirname, "..", "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links in posts open in the browser, never inside the launcher.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    settings = new Settings(paths.settings);
    connectRepo();
    account = new Account({ file: paths.auth, clientId: config.clientId, safeStorage, BrowserWindow, session });
    registerIpc();
    createWindow();
    updater.init({ send });
  });
  app.on("window-all-closed", () => app.quit());
}
