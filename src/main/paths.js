const path = require("node:path");

// Everything lives under %APPDATA%\.rhinedottir so it never touches the official launcher's files.
function makePaths(appData) {
  const root = path.join(appData, ".rhinedottir");
  return {
    root,
    settings: path.join(root, "settings.json"),
    auth: path.join(root, "account.bin"),
    cache: path.join(root, "cache"),
    // Shared by every pack: versions, libraries, assets.
    minecraft: path.join(root, "minecraft"),
    runtimes: path.join(root, "runtimes"),
    instance: (packId) => path.join(root, "instances", packId),
  };
}

module.exports = { makePaths };
