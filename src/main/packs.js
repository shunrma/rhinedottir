// Loads the list of packs, their images and posts from the packs repo.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const POST = /^(\d{4}-\d{2}-\d{2})\s+(.+)\.md$/i;
const CATEGORIES = ["changes", "bugfixes", "news"];
const MAX_POSTS = 20;

// Downloads a repo file once, keyed by its git blob sha, and returns a file:// URL.
async function cachedImage(gh, repo, item, cacheDir) {
  const file = path.join(cacheDir, "images", `${item.sha}${path.extname(item.name).toLowerCase()}`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await gh.buffer(repo, item.path));
  }
  return pathToFileURL(file).href;
}

// Fetches the first of `candidates` that exists, without the API, cached by its content.
async function rawImage(gh, repo, candidates, cacheDir) {
  for (const p of candidates) {
    try {
      const data = await gh.buffer(repo, p);
      const hash = require("node:crypto").createHash("sha1").update(data).digest("hex");
      const file = path.join(cacheDir, "images", `${hash}${path.extname(p).toLowerCase()}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, data);
      return pathToFileURL(file).href;
    } catch (err) {
      if (err.status !== 404) console.warn("couldn't load", p, err.message);
    }
  }
  return null;
}

async function loadPosts(gh, repo, dir, list) {
  const items = list(dir).filter((i) => i.type === "file" && POST.test(i.name));
  items.sort((a, b) => b.name.localeCompare(a.name));
  return Promise.all(
    items.slice(0, MAX_POSTS).map(async (item) => {
      const [, date, title] = item.name.match(POST);
      return { date, title, body: (await gh.text(repo, item.path)).trim() };
    }),
  );
}

// Lists a folder's direct children from the repo's file tree.
function makeLister(tree) {
  return (dir) =>
    tree
      .filter((i) => i.path.startsWith(dir + "/") && !i.path.slice(dir.length + 1).includes("/"))
      .map((i) => ({ name: i.path.slice(dir.length + 1), path: i.path, type: i.type === "tree" ? "dir" : "file", sha: i.sha }));
}

async function loadPack(gh, repo, id, cacheDir, options, list, previous) {
  const base = `packs/${id}`;
  const [pack, files] = await Promise.all([
    gh.json(repo, `${base}/pack.json`),
    gh.json(repo, `${base}/files.json`).catch((err) => (err.status === 404 ? null : Promise.reject(err))),
  ]);
  // Without the file list (GitHub's keyless limit), keep the images and posts from last time.
  if (!list) {
    const media = pickMedia(previous);
    media.icon ||= await rawImage(gh, repo, [`${base}/${pack.icon || "icon.png"}`], cacheDir);
    media.background ||= await rawImage(gh, repo, ["jpg", "png", "webp", "jpeg"].map((e) => `${base}/background.${e}`), cacheDir);
    return { ...(await packInfo(id, pack, files, options)), ...media };
  }
  const rootItems = list(base);
  const galleryItems = list(`${base}/gallery`);

  const iconItem = rootItems.find((i) => i.name === (pack.icon || "icon.png"));
  const backgroundItem = rootItems.find((i) => i.type === "file" && /^background\.(png|jpe?g|webp)$/i.test(i.name));
  const gallery = galleryItems.filter((i) => i.type === "file" && IMAGE.test(i.name)).sort((a, b) => a.name.localeCompare(b.name));
  const posts = {};
  for (const c of CATEGORIES) posts[c] = await loadPosts(gh, repo, `${base}/posts/${c}`, list);

  return {
    ...(await packInfo(id, pack, files, options)),
    icon: iconItem ? await cachedImage(gh, repo, iconItem, cacheDir) : null,
    background: backgroundItem ? await cachedImage(gh, repo, backgroundItem, cacheDir) : null,
    gallery: await Promise.all(gallery.map((i) => cachedImage(gh, repo, i, cacheDir))),
    posts,
  };
}

function pickMedia(previous) {
  return {
    icon: previous?.icon || null,
    background: previous?.background || null,
    gallery: previous?.gallery || [],
    posts: previous?.posts || {},
  };
}

async function packInfo(id, pack, files, options) {
  // A vanilla entry has no files of its own and follows the latest Minecraft release.
  const vanilla = pack.type === "vanilla";
  let manifest = files;
  if (vanilla) {
    const release = await options.latestRelease();
    manifest = { version: release, minecraft: release, loader: null, files: [] };
  }

  return {
    id,
    name: pack.name,
    description: pack.description || "",
    loader: vanilla ? null : "neoforge",
    minecraft: manifest?.minecraft || pack.minecraft,
    neoforge: vanilla ? null : manifest?.loader?.version || pack.loader?.version,
    // Latest published version, or null if the pack was never published.
    version: manifest?.version || null,
    files: manifest,
    // Up to four buttons on the right. One without a url still shows, as "coming soon".
    links: (pack.links || []).slice(0, 4),
    distantHorizons: pack.distantHorizons?.levels?.length ? pack.distantHorizons : null,
  };
}

/**
 * Fetches every pack. If GitHub can't be reached, falls back to the last copy
 * saved on disk so the launcher still opens offline.
 */
async function loadCatalog(gh, repo, cacheDir, options = {}) {
  const cacheFile = path.join(cacheDir, "catalog.json");
  try {
    const { packs: ids } = await gh.json(repo, "packs.json");
    // One API call lists every file; everything else comes from raw files, which have no limit.
    const tree = await gh.tree(repo).catch((err) => {
      console.warn("couldn't list the repo's files", err.message);
      return null;
    });
    const list = tree ? makeLister(tree) : null;
    const previous = new Map((readCachedCatalog(cacheDir) || []).map((p) => [p.id, p]));
    // One broken pack (or Mojang being unreachable for the vanilla entry) shouldn't hide the others.
    const results = await Promise.allSettled(ids.map((id) => loadPack(gh, repo, id, cacheDir, options, list, previous.get(id))));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === results.length && failed.length) throw failed[0].reason;
    for (const f of failed) console.error("pack failed to load", f.reason);
    const packs = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(packs));
    return { packs, offline: false };
  } catch (err) {
    if (fs.existsSync(cacheFile)) return { packs: JSON.parse(fs.readFileSync(cacheFile, "utf8")), offline: true, error: err.message };
    throw err;
  }
}

// The packs as they were last loaded, so the launcher can open before GitHub answers.
function readCachedCatalog(cacheDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir, "catalog.json"), "utf8"));
  } catch {
    return null;
  }
}

module.exports = { loadCatalog, readCachedCatalog };
