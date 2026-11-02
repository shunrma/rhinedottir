// Values baked into the launcher at build time (see .github/workflows/build.yml).
// During development they can be set with environment variables instead.
const fs = require("node:fs");
const path = require("node:path");

let baked = {};
const bakedPath = path.join(__dirname, "build-config.json");
if (fs.existsSync(bakedPath)) baked = JSON.parse(fs.readFileSync(bakedPath, "utf8"));

module.exports = {
  // Azure app registration "Application (client) ID". Not a secret.
  clientId: process.env.CM_CLIENT_ID || baked.clientId || "164b90be-19f0-48b6-bd72-a17b4d6eeca5",
  // Read-only token for the private packs repo (and launcher releases).
  githubToken: process.env.CM_GITHUB_TOKEN || baked.githubToken || "",
  // The launcher and the packs both live in the public Rhinedottir repo.
  packsRepo: process.env.CM_PACKS_REPO || baked.packsRepo || "shunrma/rhinedottir",
  launcherRepo: process.env.CM_LAUNCHER_REPO || baked.launcherRepo || "shunrma/rhinedottir",
  githubApi: process.env.CM_GITHUB_API || "https://api.github.com",
  // Dev builds skip Microsoft sign-in, launch Minecraft offline under the Windows user
  // name, and read packs from GitHub.
  devMode: process.env.CM_DEV_MODE === "1" || baked.devMode === true,
};
