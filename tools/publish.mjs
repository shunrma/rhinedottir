#!/usr/bin/env node
// Publishes a new version of a pack from a local Minecraft instance folder.
//
//   node tools/publish.mjs --pack create-motion --from "C:\path\to\instance" [--version 1.2.0] [--options] [--dry-run]
//
// The pack's files are committed to the repo under packs/<pack>/files/, and only files
// that changed are uploaded. The list of files for the current version is written to
// packs/<pack>/files.json, which is what the launcher reads. Everything goes in as one
// commit, so the launcher never sees half a publish.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const REPO = process.env.CM_PACKS_REPO || "shunrma/rhinedottir";
const BRANCH = "main";
const API = process.env.CM_GITHUB_API || "https://api.github.com";
const UPLOAD_CONCURRENCY = 4;
// Files that belong to each player once installed. They are only replaced when a
// publish is run with --options and the file actually changed.
const USER_FILES = ["options.txt"];

function parseArgs(argv) {
  const args = { options: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") args.pack = argv[++i];
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--version") args.version = argv[++i];
    else if (a === "--options") args.options = true;
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const tokenFile = fileURLToPath(new URL("./.token", import.meta.url));
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = await rl.question("GitHub token (with write access to the rhinedottir repo): ");
  rl.close();
  return token.trim();
}

function makeGitHub(token) {
  async function call(method, url, body, headers = {}) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url.startsWith("http") ? url : API + url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body && !(body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 404 && method === "GET") return null;
      if (res.ok) return res.status === 204 ? null : res.json();
      const text = await res.text();
      if (attempt < 4 && (res.status >= 500 || res.status === 429)) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
    }
  }
  return { call };
}

async function getJsonFile(gh, path) {
  const res = await gh.call("GET", `/repos/${REPO}/contents/${path}`);
  if (!res) return { data: null, sha: undefined };
  return { data: JSON.parse(Buffer.from(res.content, "base64").toString("utf8")), sha: res.sha };
}

const jsonText = (data) => JSON.stringify(data, null, 2) + "\n";

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
  return new RegExp(`(^|/)${escaped}$`, "i");
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha1(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

function bumpPatch(version) {
  const [major = 0, minor = 0, patch = 0] = (version || "0.0.0").split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// CurseForge writes the mod loader into minecraftinstance.json, e.g. "neoforge-21.1.172".
function detectNeoForge(instanceDir) {
  const file = join(instanceDir, "minecraftinstance.json");
  if (!existsSync(file)) return null;
  const name = JSON.parse(readFileSync(file, "utf8"))?.baseModLoader?.name || "";
  const match = name.match(/^neoforge-(.+)$/i);
  return match ? match[1] : null;
}

async function runPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pack || !args.from) throw new Error('Usage: publish.mjs --pack <id> --from "<instance folder>" [--version x.y.z] [--options] [--dry-run]');
  if (!existsSync(args.from)) throw new Error(`Folder not found: ${args.from}`);

  const gh = makeGitHub(await getToken());
  const packPath = `packs/${args.pack}/pack.json`;
  const filesPath = `packs/${args.pack}/files.json`;
  const { data: pack } = await getJsonFile(gh, packPath);
  if (!pack) throw new Error(`${packPath} does not exist in ${REPO}`);
  const { data: previous } = await getJsonFile(gh, filesPath);

  const version = args.version || (previous ? bumpPatch(previous.version) : "1.0.0");
  const loaderVersion = detectNeoForge(args.from) || pack.loader.version;
  if (!loaderVersion) throw new Error("Could not detect the NeoForge version. Set loader.version in pack.json.");

  // Collect the files to ship.
  const includes = new Set(pack.include);
  const excludes = (pack.exclude || []).map(globToRegex);
  const paths = [];
  for (const top of includes) {
    const dir = join(args.from, top);
    if (existsSync(dir) && statSync(dir).isDirectory()) paths.push(...(await walk(dir)));
  }
  if (args.options) {
    for (const name of USER_FILES) if (existsSync(join(args.from, name))) paths.push(join(args.from, name));
  }

  const files = [];
  for (const full of paths) {
    const path = relative(args.from, full).split(sep).join("/");
    if (excludes.some((re) => re.test(path))) continue;
    const entry = { path, sha1: await sha1(full), size: statSync(full).size, full };
    if (USER_FILES.includes(path)) entry.user = true;
    files.push(entry);
  }
  // Without --options, keep the previously published player files exactly as they were.
  if (!args.options && previous) {
    for (const f of previous.files) if (f.user) files.push({ ...f, carried: true });
  }

  const oldPaths = new Map((previous?.files || []).map((f) => [f.path, f.sha1]));
  const newPaths = new Set(files.map((f) => f.path));
  const added = files.filter((f) => !oldPaths.has(f.path)).length;
  const changed = files.filter((f) => oldPaths.has(f.path) && oldPaths.get(f.path) !== f.sha1).length;
  const removed = [...oldPaths.keys()].filter((p) => !newPaths.has(p)).length;
  const toUpload = files.filter((f) => !f.carried && oldPaths.get(f.path) !== f.sha1);
  const uploadBytes = toUpload.reduce((n, f) => n + f.size, 0);

  console.log(`${pack.name} ${previous?.version || "(first publish)"} -> ${version}`);
  console.log(`Minecraft ${pack.minecraft}, NeoForge ${loaderVersion}`);
  console.log(`${files.length} files: ${added} added, ${changed} changed, ${removed} removed`);
  console.log(`${toUpload.length} files to upload (${(uploadBytes / 1048576).toFixed(1)} MB)`);
  if (args.dryRun) return;

  // Upload the new and changed files.
  let done = 0;
  const blobs = new Map();
  await runPool(toUpload, UPLOAD_CONCURRENCY, async (f) => {
    const blob = await gh.call("POST", `/repos/${REPO}/git/blobs`, {
      content: (await readFile(f.full)).toString("base64"),
      encoding: "base64",
    });
    blobs.set(f.path, blob.sha);
    process.stdout.write(`\rUploaded ${++done}/${toUpload.length}`);
  });
  if (toUpload.length) process.stdout.write("\n");

  const manifest = {
    pack: args.pack,
    version,
    minecraft: pack.minecraft,
    loader: { type: "neoforge", version: loaderVersion },
    published: new Date().toISOString(),
    files: files
      .map(({ path, sha1, size, user }) => ({ path, sha1, size, ...(user ? { user: true } : {}) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };

  // One commit: new and changed files, removed files, files.json and pack.json.
  const ref = await gh.call("GET", `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const head = await gh.call("GET", `/repos/${REPO}/git/commits/${ref.object.sha}`);
  const base = `packs/${args.pack}/files/`;
  const tree = [
    ...[...blobs].map(([path, sha]) => ({ path: base + path, mode: "100644", type: "blob", sha })),
    ...[...oldPaths.keys()].filter((p) => !newPaths.has(p)).map((p) => ({ path: base + p, mode: "100644", type: "blob", sha: null })),
    { path: filesPath, mode: "100644", type: "blob", content: jsonText(manifest) },
    { path: packPath, mode: "100644", type: "blob", content: jsonText({ ...pack, version, loader: { type: "neoforge", version: loaderVersion } }) },
  ];
  const newTree = await gh.call("POST", `/repos/${REPO}/git/trees`, { base_tree: head.tree.sha, tree });
  const commit = await gh.call("POST", `/repos/${REPO}/git/commits`, {
    message: `Publish ${pack.name} ${version}`,
    tree: newTree.sha,
    parents: [head.sha],
  });
  await gh.call("PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha });
  console.log(`Published ${pack.name} ${version}. Launchers will see it the next time they check for updates.`);
}

main().catch((err) => {
  console.error(`\nPublish failed: ${err.message}`);
  process.exit(1);
});
