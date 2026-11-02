const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function stream(res, dest, onBytes) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = Readable.fromWeb(res.body);
  if (onBytes) body.on("data", (chunk) => onBytes(chunk.length));
  await pipeline(body, fs.createWriteStream(dest));
}

// Minimal read-only client for the Rhinedottir repo. The repo is public, so no token is
// needed; one is still sent if the build has one. Files are read from
// raw.githubusercontent.com, which isn't held to the API's 60-requests-an-hour limit.
function createGitHub({ token, api = "https://api.github.com", raw = "https://raw.githubusercontent.com", ref = "main" }) {
  async function request(url, accept = "application/vnd.github+json") {
    const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Rhinedottir" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url.startsWith("http") ? url : api + url, { headers, redirect: "follow" });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 404 ? " (is the file in the Rhinedottir repo?)" : "";
      throw new GitHubError(`GitHub request failed: ${res.status} ${url}${hint}`, res.status);
    }
    return res;
  }

  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const contents = (repo, p) => `/repos/${repo}/contents/${enc(p)}`;
  const rawUrl = (repo, p) => `${raw}/${repo}/${ref}/${enc(p)}`;

  return {
    async json(repo, p) {
      return (await request(rawUrl(repo, p), "*/*")).json();
    },
    async text(repo, p) {
      return (await request(rawUrl(repo, p), "*/*")).text();
    },
    async buffer(repo, p) {
      return Buffer.from(await (await request(rawUrl(repo, p), "*/*")).arrayBuffer());
    },
    // Streams a file from the repo to disk.
    async downloadFile(repo, p, dest, onBytes) {
      await stream(await request(rawUrl(repo, p), "*/*"), dest, onBytes);
    },
    // Lists a folder. A missing folder is treated as empty.
    async list(repo, p) {
      try {
        const items = await (await request(contents(repo, p))).json();
        return Array.isArray(items) ? items : [];
      } catch (err) {
        if (err.status === 404) return [];
        throw err;
      }
    },
    // Streams a release asset to disk. GitHub redirects to storage; fetch drops the
    // Authorization header on that cross-origin redirect, which is what storage expects.
    async downloadAsset(repo, assetId, dest, onBytes) {
      await stream(await request(`/repos/${repo}/releases/assets/${assetId}`, "application/octet-stream"), dest, onBytes);
    },
    async releaseByTag(repo, tag) {
      return (await request(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)).json();
    },
    async latestRelease(repo) {
      return (await request(`/repos/${repo}/releases/latest`)).json();
    },
  };
}

module.exports = { createGitHub, GitHubError };
