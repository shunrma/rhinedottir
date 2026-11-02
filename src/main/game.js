// Installs Minecraft, NeoForge and Java, and launches the game.
const fs = require("node:fs");
const path = require("node:path");
const { MinecraftFolder, Version, launch } = require("@xmcl/core");
const {
  getVersionList,
  installTask,
  installDependenciesTask,
  installNeoForgedTask,
  installJavaRuntimeTask,
} = require("@xmcl/installer");

const isWindows = process.platform === "win32";

const JAVA_RUNTIMES_URL =
  "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

// Mojang's name for this computer in the Java runtime index.
function javaPlatformKey() {
  const arm = process.arch === "arm64";
  if (process.platform === "win32") return arm ? "windows-arm64" : process.arch === "ia32" ? "windows-x86" : "windows-x64";
  if (process.platform === "darwin") return arm ? "mac-os-arm64" : "mac-os";
  return process.arch === "ia32" ? "linux-i386" : "linux";
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return res.json();
}

// Same result as @xmcl/installer's fetchJavaRuntimeManifest. Theirs passes an option
// (throwOnError) that the undici version they ship no longer accepts, so it always fails.
async function fetchJavaRuntimeManifest({ target }) {
  const index = await getJson(JAVA_RUNTIMES_URL);
  const entry = index[javaPlatformKey()]?.[target]?.[0];
  if (!entry) throw new Error(`Mojang has no ${target} Java for this computer.`);
  const manifest = await getJson(entry.manifest.url);
  return { files: manifest.files, target, version: entry.version };
}

// Runs an xmcl task and reports overall progress as a 0..1 fraction.
async function runTask(task, label, onProgress) {
  let last = 0;
  return task.startAndWait({
    onUpdate() {
      const now = Date.now();
      if (now - last < 100 || !task.total) return;
      last = now;
      onProgress({ label, fraction: Math.min(1, task.progress / task.total) });
    },
  });
}

function javaPaths(runtimeDir) {
  const bin = path.join(runtimeDir, "bin");
  return {
    // java.exe for installer steps, javaw.exe for the game so no console window opens.
    java: path.join(bin, isWindows ? "java.exe" : "java"),
    javaw: path.join(bin, isWindows ? "javaw.exe" : "java"),
  };
}

function versionInstalled(minecraftDir, id) {
  return fs.existsSync(path.join(minecraftDir, "versions", id, `${id}.json`));
}

/**
 * Makes sure Minecraft, Java and NeoForge for a pack are installed.
 * Returns what's needed to launch it.
 */
async function ensureGame({ minecraftDir, runtimesDir, minecraft, neoforge }, onProgress = () => {}) {
  const mc = MinecraftFolder.from(minecraftDir);

  // 1. Vanilla Minecraft.
  if (!versionInstalled(minecraftDir, minecraft)) {
    onProgress({ label: "Getting Minecraft version list", fraction: 0 });
    const list = await getVersionList();
    const meta = list.versions.find((v) => v.id === minecraft);
    if (!meta) throw new Error(`Minecraft ${minecraft} wasn't found.`);
    await runTask(installTask(meta, mc), `Installing Minecraft ${minecraft}`, onProgress);
  }
  const vanilla = await Version.parse(mc, minecraft);

  // 2. The Java version Mojang specifies for this Minecraft version.
  const component = vanilla.javaVersion?.component || "java-runtime-delta";
  const runtimeDir = path.join(runtimesDir, component);
  const java = javaPaths(runtimeDir);
  if (!fs.existsSync(java.java)) {
    onProgress({ label: "Getting Java", fraction: 0 });
    const manifest = await fetchJavaRuntimeManifest({ target: component });
    await runTask(installJavaRuntimeTask({ destination: runtimeDir, manifest }), "Installing Java", onProgress);
    if (!isWindows) fs.chmodSync(java.java, 0o755);
  }

  // Vanilla: nothing more to add.
  if (!neoforge) {
    await runTask(installDependenciesTask(vanilla), "Checking game files", onProgress);
    return { versionId: minecraft, javaPath: java.javaw };
  }

  // 3. NeoForge.
  const neoforgeId = `neoforge-${neoforge}`;
  if (!versionInstalled(minecraftDir, neoforgeId)) {
    await runTask(installNeoForgedTask("neoforge", neoforge, mc, { java: java.java }), `Installing NeoForge ${neoforge}`, onProgress);
  }

  // 4. Libraries and assets (also repairs anything missing or corrupted).
  const resolved = await Version.parse(mc, neoforgeId);
  await runTask(installDependenciesTask(resolved), "Checking game files", onProgress);

  return { versionId: neoforgeId, javaPath: java.javaw };
}

/**
 * Starts the game. Resolves with the child process once it has spawned.
 */
async function launchGame({ minecraftDir, instanceDir, versionId, javaPath, session, memoryGB, offline = false }) {
  fs.mkdirSync(instanceDir, { recursive: true });
  return launch({
    gamePath: instanceDir,
    resourcePath: minecraftDir,
    javaPath,
    version: versionId,
    gameProfile: session.profile,
    accessToken: session.accessToken,
    userType: offline ? "legacy" : "msa",
    launcherName: "Rhinedottir",
    launcherBrand: "Rhinedottir",
    minMemory: 1024,
    maxMemory: Math.round(memoryGB * 1024),
    extraExecOption: { detached: true },
  });
}

// Latest stable NeoForge build for a Minecraft version, e.g. 1.21.1 -> 21.1.x.
async function latestNeoForge(minecraft) {
  const [, minor, patch = "0"] = minecraft.split(".");
  const prefix = `${minor}.${patch}.`;
  const res = await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml");
  if (!res.ok) throw new Error(`Couldn't get the NeoForge version list (${res.status}).`);
  const versions = [...(await res.text()).matchAll(/<version>([^<]+)<\/version>/g)]
    .map((m) => m[1])
    .filter((v) => v.startsWith(prefix) && !/beta|alpha|rc/i.test(v));
  if (!versions.length) throw new Error(`No NeoForge release found for Minecraft ${minecraft}.`);
  return versions.sort((a, b) => Number(a.split(".")[2]) - Number(b.split(".")[2])).pop();
}

// The UUID Minecraft itself uses for an offline player name.
function offlineProfile(name) {
  const hash = require("node:crypto").createHash("md5").update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return { id: hash.toString("hex"), name };
}

module.exports = { ensureGame, launchGame, latestNeoForge, offlineProfile, fetchJavaRuntimeManifest };
