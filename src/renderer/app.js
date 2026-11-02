const api = window.launcher;
const $ = (id) => document.getElementById(id);

const state = {
  packs: [],
  selected: null,
  account: null,
  devMode: false, // dev builds have no sign-in at all
  settings: {},
  busy: null,
  running: null,
};

const LINK_ICONS = {
  ...window.BRAND_ICONS,
  website: "M12 2a10 10 0 100 20 10 10 0 000-20zm6.93 6h-2.95a15.7 15.7 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 010-4h3.38a16.5 16.5 0 000 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 015.07 16zm2.95-8H5.07a8 8 0 014.33-3.56A15.7 15.7 0 008.02 8zM12 19.96A14.1 14.1 0 0110.09 16h3.82A14.1 14.1 0 0112 19.96zM14.34 14H9.66a14.7 14.7 0 010-4h4.68a14.7 14.7 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.5 16.5 0 000-4h3.38a8.2 8.2 0 010 4h-3.38z",
};

// ---------- helpers ----------

let toastTimer;
function toast(message, isError = false, sound = isError ? "error" : "notify") {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  sfx.play(sound);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), isError ? 8000 : 4000);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) node.append(child);
  return node;
}

function svgIcon(pathData) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

const currentPack = () => state.packs.find((p) => p.id === state.selected);

// ---------- rendering ----------

const STATUS_TEXT = {
  ready: (s) => `Installed · ${s.installedVersion}`,
  update: () => "Update available",
  "not-installed": () => "Not installed",
  unpublished: () => "Coming soon",
};

function renderPackList() {
  // The pack rail is hidden while there's only one pack.
  const list = $("packList");
  if (!list) return;
  list.replaceChildren();
  for (const pack of state.packs) {
    const btn = el("button", { className: "pack" + (pack.id === state.selected ? " active" : ""), ariaLabel: pack.name });
    const icon = el("span", { className: "pack-icon" });
    icon.append(pack.icon ? el("img", { src: pack.icon, alt: "" }) : pack.name.slice(0, 2).toUpperCase());
    btn.append(icon);
    const s = pack.status;
    if (s.state === "update") btn.append(el("span", { className: "dot" }));
    btn.onclick = () => selectPack(pack.id);
    btn.onmouseenter = () => showTooltip(btn, pack.name, STATUS_TEXT[s.state](s), s.state === "update");
    btn.onmouseleave = () => $("tooltip").classList.add("hidden");
    list.append(btn);
  }
}

function showTooltip(anchor, title, sub, highlight) {
  const tip = $("tooltip");
  tip.replaceChildren(el("strong", { textContent: title }), el("span", { className: highlight ? "update" : "", textContent: sub }));
  const frame = $("frame").getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  const scale = frame.width / $("frame").offsetWidth || 1;
  tip.style.top = `${(box.top - frame.top) / scale + 3}px`;
  tip.classList.remove("hidden");
}

function renderLinks(pack) {
  const box = $("links");
  box.replaceChildren();
  for (const link of pack.links) {
    const name = link.label || link.type;
    const btn = el("button", { title: link.url ? name : `${name} (coming soon)` });
    btn.append(svgIcon(LINK_ICONS[link.type] || LINK_ICONS.website));
    btn.onclick = () =>
      link.url ? api.openLink(link.url).catch((e) => toast(e.message, true)) : toast(`${name} isn't set up yet.`);
    box.append(btn);
  }
}

function renderStart() {
  const pack = currentPack();
  const btn = $("startBtn");
  const label = $("startLabel");
  btn.classList.remove("update");
  btn.disabled = !!state.busy;
  if (!pack) {
    label.textContent = "No packs";
    btn.disabled = true;
    return;
  }
  const s = pack.status.state;
  if (state.running === pack.id) {
    label.textContent = "Game Running";
    btn.disabled = true;
  } else if (state.busy === pack.id) label.textContent = "Working…";
  else if (s === "unpublished") {
    label.textContent = "Coming Soon";
    btn.disabled = true;
  } else if (s === "not-installed") label.textContent = "Install";
  else if (s === "update") {
    label.textContent = "Update";
    btn.classList.add("update");
  } else label.textContent = "Start Game";
  const showDownload = s === "update" || s === "not-installed";
  $("startIconPath").setAttribute("d", showDownload ? "M11 4h2v9.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM5 18h14v2H5z" : "M8 5v14l11-7z");
  $("menuBadge").classList.toggle("hidden", s !== "update");
}

function renderPack() {
  const pack = currentPack();
  renderPackList();
  if (!pack) {
    $("packName").textContent = "No packs yet";
    renderStart();
    return;
  }
  $("packName").textContent = pack.name;
  $("dhBtn").classList.toggle("hidden", !pack.distantHorizons);


  setBackgrounds(pack.background ? [pack.background] : pack.gallery);
  renderLinks(pack);
  renderStart();
}

// Crossfades to new background images. A pack with several gallery images and no
// background.jpg slowly cycles through them.
let bgTimer;
let bgKey = "";
function setBackgrounds(images) {
  const key = images.join("|");
  if (key === bgKey) return;
  bgKey = key;
  clearInterval(bgTimer);
  let i = 0;
  showBackground(images[0]);
  if (images.length > 1) bgTimer = setInterval(() => showBackground(images[(i = (i + 1) % images.length)]), 9000);
}

function showBackground(src) {
  const host = $("background");
  const layer = el("div", { className: "bg-layer" });
  if (src) layer.style.backgroundImage = `url("${src}")`;
  host.append(layer);
  // The very first background is already there when the window appears; later ones fade in.
  if (host.children.length === 1) layer.classList.add("shown", "instant");
  else requestAnimationFrame(() => layer.classList.add("shown"));
  setTimeout(() => {
    while (host.children.length > 1) host.firstElementChild.remove();
  }, 900);
}

function renderAccountChip() {
  const chip = $("accountChip");
  chip.classList.toggle("signed-in", !!state.account);
  $("accountChipName").textContent = state.account ? state.account.name : "Sign in";
  $("accountAvatar").textContent = state.account ? state.account.name.slice(0, 1).toUpperCase() : "?";
}

function renderSettings() {
  renderAccountChip();
  $("accountName").textContent = state.account ? state.account.name : "Not signed in";
  $("accountBtn").textContent = state.account ? "Log out" : "Sign in";
  $("accountBtn").classList.toggle("primary", !state.account);
  $("memory").value = state.settings.memoryGB;
  $("memoryValue").textContent = `${state.settings.memoryGB} GB`;
  $("sounds").checked = state.settings.sounds !== false;
  sfx.setEnabled(state.settings.sounds !== false);
  document.querySelector(".github-setting").classList.toggle("baked", !!state.settings.githubKeyBaked);
  $("githubKeyStatus").textContent = state.settings.hasGitHubKey
    ? "Saved. The launcher downloads the mods from GitHub."
    : "Needed to download the mods from GitHub";
  $("githubKey").placeholder = state.settings.hasGitHubKey ? "Paste a new key" : "Paste key";
}

function selectPack(id) {
  if (id === state.selected) return;
  state.selected = id;
  renderPack();
  for (const node of [$("brand"), $("dock")]) {
    node.classList.remove("fade-in");
    void node.offsetWidth;
    node.classList.add("fade-in");
  }
  api.setSettings({ lastPack: id }).catch(() => {});
}

function updatePack(updated) {
  state.packs = state.packs.map((p) => (p.id === updated.id ? updated : p));
  renderPack();
}

function applyCatalog(catalog) {
  state.packs = catalog.packs;
  if (!state.packs.some((p) => p.id === state.selected)) state.selected = state.packs[0]?.id || null;
  renderPack();
  if (catalog.offline) toast("Couldn't reach GitHub, so this may be out of date. You can still play.", true);
}

// ---------- actions ----------

async function ensureSignedIn() {
  if (state.account || state.devMode) return true;
  try {
    state.account = await api.login();
    renderSettings();
    toast(`Signed in as ${state.account.name}`);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

async function onStart() {
  const pack = currentPack();
  if (!pack || state.busy) return;
  sfx.play("start");
  try {
    if (pack.status.state === "ready") {
      if (!(await ensureSignedIn())) return;
      updatePack(await api.play(pack.id));
    } else {
      updatePack(await api.install(pack.id));
      toast(`${pack.name} is ready to play.`, false, "success");
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("progress").classList.add("hidden");
    renderStart();
  }
}

async function checkForUpdates() {
  try {
    applyCatalog(await api.refresh());
    const pack = currentPack();
    toast(pack?.status.state === "update" ? `An update for ${pack.name} is available.` : "Everything is up to date.");
  } catch (e) {
    toast(e.message, true);
  }
}

function openPost(post) {
  $("postDate").textContent = post.date;
  $("postTitle").textContent = post.title;
  $("postBody").textContent = post.body;
  $("postOverlay").classList.remove("hidden");
}

// ---------- wiring ----------

function wire() {
  $("minBtn").onclick = () => api.minimize();
  $("closeBtn").onclick = () => api.close();
  $("startBtn").onclick = onStart;

  const menu = $("packMenu");
  $("menuBtn").onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  };
  document.addEventListener("click", () => menu.classList.add("hidden"));
  menu.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    menu.classList.add("hidden");
    const pack = currentPack();
    if (!pack) return;
    try {
      if (btn.dataset.folder) await api.openFolder(pack.id, btn.dataset.folder);
      else if (btn.id === "dhBtn") await openDistantHorizons(pack);
      else if (btn.id === "checkUpdatesBtn") await checkForUpdates();
      else if (btn.id === "uninstallBtn") updatePack(await api.uninstall(pack.id));
    } catch (err) {
      toast(err.message, true);
    }
  };

  $("accountChip").onclick = () => {
    if (!state.account) return ensureSignedIn();
    renderSettings();
    $("settingsOverlay").classList.remove("hidden");
  };

  $("settingsBtn").onclick = () => {
    renderSettings();
    $("settingsOverlay").classList.remove("hidden");
  };
  for (const overlay of document.querySelectorAll(".overlay")) {
    overlay.onclick = (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) overlay.classList.add("hidden");
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") for (const o of document.querySelectorAll(".overlay")) o.classList.add("hidden");
  });

  $("accountBtn").onclick = async () => {
    try {
      if (state.account) {
        await api.logout();
        state.account = null;
        toast("Logged out.");
      } else {
        await ensureSignedIn();
      }
    } catch (e) {
      toast(e.message, true);
    }
    renderSettings();
  };

  $("memory").oninput = (e) => ($("memoryValue").textContent = `${e.target.value} GB`);
  $("memory").onchange = async (e) => {
    state.settings = await api.setSettings({ memoryGB: Number(e.target.value) });
    renderSettings();
  };

  $("sounds").onchange = async (e) => {
    state.settings = await api.setSettings({ sounds: e.target.checked });
    renderSettings();
  };

  $("githubKeyForm").onsubmit = async (e) => {
    e.preventDefault();
    const key = $("githubKey").value.trim();
    if (!key) return;
    $("githubKeyBtn").disabled = true;
    try {
      const catalog = await api.setGitHubKey(key);
      $("githubKey").value = "";
      state.settings = { ...state.settings, hasGitHubKey: true };
      applyCatalog(catalog);
      renderSettings();
      toast("Key saved. Press Start to download the mods.");
    } catch (err) {
      toast(err.message, true);
    } finally {
      $("githubKeyBtn").disabled = false;
    }
  };

  $("launcherUpdateBtn").onclick = async () => {
    try {
      const res = await api.checkLauncherUpdate();
      toast(res.available ? `Launcher ${res.version} is downloading. It installs when you close the launcher.` : "The launcher is up to date.");
    } catch (e) {
      toast(e.message, true);
    }
  };

  api.onProgress(({ packId, label, fraction }) => {
    if (packId !== state.selected) return;
    $("progress").classList.remove("hidden");
    $("progressLabel").textContent = label;
    $("progressPct").textContent = `${Math.round(fraction * 100)}%`;
    $("progressFill").style.width = `${fraction * 100}%`;
  });
  api.onBusy((busy) => {
    state.busy = busy;
    if (!busy) $("progress").classList.add("hidden");
    renderStart();
  });
  api.onGameState(({ packId, running }) => {
    state.running = running ? packId : null;
    renderStart();
  });
  api.onGameCrashed(({ code }) => toast(`Minecraft closed with an error (code ${code}). Check the logs folder of the pack.`, true));
  // Found by the background check: a small popup, never in the way.
  api.onLauncherUpdate((info) => {
    $("updatePopText").textContent = `Rhine Launcher ${info.version} is ready`;
    $("updatePop").classList.remove("hidden");
    sfx.play("notify");
  });
  $("updateLater").onclick = () => $("updatePop").classList.add("hidden");
  $("updateRestart").onclick = () => api.installLauncherUpdate().catch((e) => toast(e.message, true));
}

async function boot() {
  wire();
  try {
    const init = await api.init();
    state.account = init.account;
    state.devMode = !!init.devMode;
    document.body.classList.toggle("dev-mode", state.devMode);
    state.settings = init.settings;
    state.selected = init.settings.lastPack;
    $("launcherVersion").textContent = `Version ${init.version}`;
    renderSettings();
    const catalog = await api.refresh();
    // Load the first background (and fonts) before the window is shown.
    const pack = catalog.packs.find((p) => p.id === state.selected) || catalog.packs[0];
    const first = pack && (pack.background || pack.gallery?.[0]);
    await Promise.race([Promise.all([preload(first), document.fonts.ready]), wait(8000)]);
    applyCatalog(catalog);
  } catch (e) {
    $("packName").textContent = "Couldn't load packs";
    toast(e.message, true);
    renderStart();
  }
  renderSettings();
  $("splash").classList.add("done", "instant");
  // Two frames so the background is painted before the window appears.
  requestAnimationFrame(() => requestAnimationFrame(() => api.ready().catch(() => {})));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function preload(src) {
  if (!src) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(resolve) : resolve());
    img.onerror = resolve;
    img.src = src;
  });
}

boot();
