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

async function loadPosts(gh, repo, dir) {
  const items = (await gh.list(repo, dir)).filter((i) => i.type === "file" && POST.test(i.name));
  items.sort((a, b) => b.name.localeCompare(a.name));
  return Promise.all(
    items.slice(0, MAX_POSTS).map(async (item) => {
      const [, date, title] = item.name.match(POST);
      return { date, title, body: (await gh.text(repo, item.path)).trim() };
    }),
  );
}

async function loadPack(gh, repo, id, cacheDir, options) {
  const base = `packs/${id}`;
  const [pack, rootItems, galleryItems, files] = await Promise.all([
    gh.json(repo, `${base}/pack.json`),
    gh.list(repo, base),
    gh.list(repo, `${base}/gallery`),
    gh.json(repo, `${base}/files.json`).catch((err) => (err.status === 404 ? null : Promise.reject(err))),
  ]);

  const iconItem = rootItems.find((i) => i.name === (pack.icon || "icon.png"));
  const backgroundItem = rootItems.find((i) => i.type === "file" && /^background\.(png|jpe?g|webp)$/i.test(i.name));
  const gallery = galleryItems.filter((i) => i.type === "file" && IMAGE.test(i.name)).sort((a, b) => a.name.localeCompare(b.name));
  const posts = {};
  for (const c of CATEGORIES) posts[c] = await loadPosts(gh, repo, `${base}/posts/${c}`);

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
    icon: iconItem ? await cachedImage(gh, repo, iconItem, cacheDir) : null,
    background: backgroundItem ? await cachedImage(gh, repo, backgroundItem, cacheDir) : null,
    gallery: await Promise.all(gallery.map((i) => cachedImage(gh, repo, i, cacheDir))),
    posts,
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
    // One broken pack (or Mojang being unreachable for the vanilla entry) shouldn't hide the others.
    const results = await Promise.allSettled(ids.map((id) => loadPack(gh, repo, id, cacheDir, options)));
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
