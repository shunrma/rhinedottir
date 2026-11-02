const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadCatalog } = require("../src/main/packs");

// In-memory stand-in for the packs repo.
function fakeGitHub(files) {
  const notFound = () => Object.assign(new Error("404"), { status: 404 });
  const get = (p) => {
    if (!(p in files)) throw notFound();
    return files[p];
  };
  return {
    async json(_r, p) {
      return JSON.parse(get(p));
    },
    async text(_r, p) {
      return get(p);
    },
    async buffer(_r, p) {
      return Buffer.from(get(p));
    },
    async tree() {
      const dirs = new Set();
      for (const p of Object.keys(files)) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      }
      return [
        ...[...dirs].map((p) => ({ path: p, type: "tree", sha: "d" })),
        ...Object.keys(files).map((p) => ({ path: p, type: "blob", sha: Buffer.from(p).toString("hex") })),
      ];
    },
    async list(_r, dir) {
      const prefix = dir + "/";
      const names = new Set(Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]));
      return [...names].map((name) => {
        const full = prefix + name;
        const isFile = full in files;
        return { name, path: full, type: isFile ? "file" : "dir", sha: isFile ? Buffer.from(full).toString("hex") : undefined };
      });
    },
  };
}

const repo = {
  "packs.json": JSON.stringify({ packs: ["a", "b", "vanilla"] }),
  "packs/vanilla/pack.json": JSON.stringify({ name: "Minecraft", type: "vanilla" }),
  "packs/a/pack.json": JSON.stringify({
    name: "Pack A",
    minecraft: "1.21.1",
    loader: { version: "" },
    links: [{ type: "discord", url: "https://discord.gg/x" }, { type: "youtube", url: "" }],
  }),
  "packs/a/files.json": JSON.stringify({ version: "1.2.0", minecraft: "1.21.1", loader: { version: "21.1.172" }, files: [] }),
  "packs/a/icon.png": "icon",
  "packs/a/gallery/02-b.png": "b",
  "packs/a/gallery/01-a.jpg": "a",
  "packs/a/gallery/notes.txt": "ignored",
  "packs/a/posts/news/2026-10-01 Old news.md": "old",
  "packs/a/posts/news/2026-10-20 New news.md": "  new  ",
  "packs/a/posts/news/README.md": "ignored",
  "packs/b/pack.json": JSON.stringify({ name: "Pack B", minecraft: "1.21.1", loader: { version: "21.1.1" } }),
};

test("loads packs, images and posts, newest posts first", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cm-cat-"));
  const { packs, offline } = await loadCatalog(fakeGitHub(repo), "x/y", cache, { latestRelease: async () => "9.9.9" });
  assert.equal(offline, false);
  const [a, b, vanilla] = packs;
  assert.equal(vanilla.version, "9.9.9");
  assert.equal(vanilla.minecraft, "9.9.9");
  assert.equal(vanilla.neoforge, null);
  assert.deepEqual(vanilla.files.files, []);
  assert.equal(a.loader, "neoforge");
  assert.equal(a.version, "1.2.0");
  assert.equal(a.neoforge, "21.1.172");
  assert.equal(a.gallery.length, 2);
  assert.match(a.gallery[0], /\.jpg$/);
  assert.ok(a.icon.startsWith("file://"));
  assert.deepEqual(a.posts.news.map((p) => [p.date, p.title, p.body]), [["2026-10-20", "New news", "new"], ["2026-10-01", "Old news", "old"]]);
  assert.deepEqual(a.posts.changes, []);
  // Links without a url still show (as "coming soon").
  assert.deepEqual(a.links.map((l) => l.type), ["discord", "youtube"]);
  assert.equal(b.version, null);
  assert.equal(b.icon, null);
});

test("falls back to the cached catalog when offline", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cm-cat-"));
  await loadCatalog(fakeGitHub(repo), "x/y", cache, { latestRelease: async () => "9.9.9" });
  const broken = { json: async () => { throw new Error("offline"); } };
  const { packs, offline } = await loadCatalog(broken, "x/y", cache);
  assert.equal(offline, true);
  assert.equal(packs[0].name, "Pack A");
});

test("keeps last time's images when the file list can't be fetched", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cm-cat-"));
  const gh = fakeGitHub(repo);
  const first = await loadCatalog(gh, "x/y", cache, { latestRelease: async () => "9.9.9" });
  gh.tree = async () => {
    throw Object.assign(new Error("rate limited"), { status: 403 });
  };
  const second = await loadCatalog(gh, "x/y", cache, { latestRelease: async () => "9.9.9" });
  const a1 = first.packs.find((p) => p.id === "a");
  const a2 = second.packs.find((p) => p.id === "a");
  assert.equal(second.offline, false);
  assert.ok(a2.icon);
  assert.deepEqual(a2.gallery, a1.gallery);
  assert.deepEqual(a2.posts, a1.posts);
});
