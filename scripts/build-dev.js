// Builds a dev installer: no sign-in and offline launches. Packs come from GitHub.
//   [CM_GITHUB_TOKEN=...] node scripts/build-dev.js
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const bakedConfig = path.join(root, "src", "main", "build-config.json");

const hadConfig = fs.existsSync(bakedConfig) ? fs.readFileSync(bakedConfig) : null;
// CM_GITHUB_TOKEN bakes a read-only key in, so the launcher downloads from GitHub
// without anyone pasting a key into Settings.
const baked = { devMode: true };
if (process.env.CM_GITHUB_TOKEN) baked.githubToken = process.env.CM_GITHUB_TOKEN.trim();
fs.writeFileSync(bakedConfig, JSON.stringify(baked));
try {
  execFileSync(
    process.execPath,
    [
      require.resolve("electron-builder/cli.js"),
      "--win",
      "nsis",
      "--publish",
      "never",
      "-c.nsis.artifactName=Rhinedottir-Dev-Setup-${version}.${ext}",
    ],
    { cwd: root, stdio: "inherit" },
  );
} finally {
  if (hadConfig) fs.writeFileSync(bakedConfig, hadConfig);
  else fs.rmSync(bakedConfig);
}
