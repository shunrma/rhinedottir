// Real install + launch check, run on a Windows CI machine (see .github/workflows/build.yml).
// Installs Minecraft 1.21.1, Java and the latest NeoForge 21.1 into a temp folder, starts
// the game with a dummy account, and waits until Minecraft reports it is loading.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureGame, launchGame } = require("../src/main/game");

async function latestNeoForge() {
  const xml = await (await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")).text();
  const versions = [...xml.matchAll(/<version>(21\.1\.\d+)<\/version>/g)].map((m) => m[1]);
  return versions.at(-1);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cm-smoke-"));
  const neoforge = process.env.NEOFORGE || (await latestNeoForge());
  console.log(`Installing Minecraft 1.21.1 + NeoForge ${neoforge} into ${root}`);

  let lastLabel = "";
  const game = await ensureGame(
    { minecraftDir: path.join(root, "minecraft"), runtimesDir: path.join(root, "runtimes"), minecraft: "1.21.1", neoforge },
    ({ label }) => {
      if (label !== lastLabel) console.log(`  ${label}`);
      lastLabel = label;
    },
  );
  console.log("Installed:", game);
  if (!fs.existsSync(game.javaPath)) throw new Error(`Java missing at ${game.javaPath}`);

  const proc = await launchGame({
    minecraftDir: path.join(root, "minecraft"),
    instanceDir: path.join(root, "instance"),
    versionId: game.versionId,
    javaPath: game.javaPath,
    session: { accessToken: "0", profile: { id: "00000000000000000000000000000000", name: "SmokeTest" } },
    memoryGB: 2,
  });

  const ok = await new Promise((resolve) => {
    let output = "";
    const timer = setTimeout(() => resolve(false), 240_000);
    const onData = (d) => {
      output += d;
      process.stdout.write(d);
      // Printed once NeoForge has loaded mods and Minecraft itself is starting.
      if (/Setting user: SmokeTest|Backend library: LWJGL/.test(output)) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      console.log(`Game exited with code ${code}`);
      resolve(/Setting user: SmokeTest|Backend library: LWJGL/.test(output));
    });
  });
  proc.kill();
  if (!ok) throw new Error("Minecraft did not reach the loading stage.");
  console.log("Smoke test passed: Minecraft with NeoForge started.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
