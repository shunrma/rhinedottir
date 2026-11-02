const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Pre-generated Distant Horizons terrain for a pack's server. pack.json lists one file per quality:
//   "distantHorizons": {
//     "folder": "<the server's folder name inside Distant_Horizons_server_data>",
//     "levels": [{ "id": "low", "label": "Low", "description": "...", "release": "dh-low", "asset": "DistantHorizons.sqlite", "size": 0, "sha1": "" }]
//   }

const DH_DIR = "Distant_Horizons_server_data";

function stateFile(instanceDir) {
  return path.join(instanceDir, ".createmotion", "dh.json");
}

function readDh(instanceDir) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(instanceDir), "utf8"));
  } catch {
    return null;
  }
}

function dhStatus(pack, instanceDir) {
  return { levels: pack.distantHorizons?.levels || [], installed: readDh(instanceDir)?.level || null };
}

async function sha1File(file) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadDh({ gh, repo, pack, instanceDir, levelId }, onProgress) {
  const dh = pack.distantHorizons;
  const level = dh?.levels?.find((l) => l.id === levelId);
  if (!level) throw new Error(`No Distant Horizons download called ${levelId}.`);
  if (!dh.folder || dh.folder.includes("..") || /[\\/]/.test(dh.folder)) throw new Error("The pack's Distant Horizons folder name isn't valid.");

  const release = await gh.releaseByTag(repo, level.release);
  const asset = release.assets.find((a) => a.name === level.asset);
  if (!asset) throw new Error(`The ${level.label} download is missing from release ${level.release}.`);

  const dest = path.join(instanceDir, DH_DIR, dh.folder, "DistantHorizons.sqlite");
  const part = dest + ".part";
  const total = asset.size;
  let done = 0;
  onProgress({ done, total });
  await gh.downloadAsset(repo, asset.id, part, (n) => {
    done += n;
    onProgress({ done, total });
  });
  if (level.sha1 && (await sha1File(part)) !== level.sha1) {
    fs.rmSync(part, { force: true });
    throw new Error("The Distant Horizons download was damaged. Try again.");
  }
  fs.renameSync(part, dest);
  fs.mkdirSync(path.dirname(stateFile(instanceDir)), { recursive: true });
  fs.writeFileSync(stateFile(instanceDir), JSON.stringify({ level: level.id, sha1: level.sha1 || null }));
  return dhStatus(pack, instanceDir);
}

module.exports = { dhStatus, downloadDh, DH_DIR };
