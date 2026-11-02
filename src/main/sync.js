// Brings an instance folder in line with a pack's files.json.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STATE_DIR = ".createmotion";
const MANIFEST_FILE = "installed.json";

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

// Refuse paths that would escape the instance folder.
function safeJoin(root, rel) {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Unsafe path in pack: ${rel}`);
  return full;
}

function readInstalled(instanceDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(instanceDir, STATE_DIR, MANIFEST_FILE), "utf8"));
  } catch {
    return null;
  }
}

function writeInstalled(instanceDir, manifest) {
  fs.mkdirSync(path.join(instanceDir, STATE_DIR), { recursive: true });
  fs.writeFileSync(path.join(instanceDir, STATE_DIR, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

/**
 * Works out what to download and delete.
 * - Pack files are replaced whenever the local copy differs from the published one.
 * - Player files (options.txt) are only written when missing, or when the pack author
 *   published a different one than last time.
 * - Files the previous version shipped but this one doesn't are deleted. Anything the
 *   player added themselves is never touched.
 */
async function planSync(instanceDir, manifest, previous) {
  const prevByPath = new Map((previous?.files || []).map((f) => [f.path, f]));
  const download = [];
  for (const f of manifest.files) {
    const local = safeJoin(instanceDir, f.path);
    const exists = fs.existsSync(local);
    if (f.user) {
      if (!exists || prevByPath.get(f.path)?.sha1 !== f.sha1) download.push(f);
    } else if (!exists || (await sha1File(local)) !== f.sha1) {
      download.push(f);
    }
  }
  const keep = new Set(manifest.files.map((f) => f.path));
  const remove = (previous?.files || []).filter((f) => !keep.has(f.path) && !f.user).map((f) => f.path);
  return { download, remove };
}

/**
 * @param download (file entry from files.json, destFile, onBytes) => Promise<void>
 * @param onProgress ({ done, total, file }) => void, in bytes
 */
async function applySync(instanceDir, manifest, plan, download, onProgress = () => {}) {
  const total = plan.download.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const tmpDir = path.join(instanceDir, STATE_DIR, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const queue = [...plan.download];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const dest = safeJoin(instanceDir, f.path);
      const tmp = path.join(tmpDir, f.sha1);
      for (let attempt = 1; ; attempt++) {
        let got = 0;
        try {
          await download(f, tmp, (n) => {
            got += n;
            done += n;
            onProgress({ done, total, file: f.path });
          });
          const actual = await sha1File(tmp);
          if (actual !== f.sha1) throw new Error(`Checksum mismatch for ${f.path}`);
          break;
        } catch (err) {
          done -= got;
          fs.rmSync(tmp, { force: true });
          if (attempt >= 3) throw err;
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { force: true });
      fs.renameSync(tmp, dest);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  for (const rel of plan.remove) fs.rmSync(safeJoin(instanceDir, rel), { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  writeInstalled(instanceDir, manifest);
}

module.exports = { planSync, applySync, readInstalled, writeInstalled, sha1File };
