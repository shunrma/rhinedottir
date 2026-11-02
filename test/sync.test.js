const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { planSync, applySync, readInstalled } = require("../src/main/sync");

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const file = (p, content, extra = {}) => ({ path: p, sha1: sha1(content), size: content.length, asset: content, ...extra });

// "Assets" are just their content, so downloading writes the asset id to disk.
const fakeDownload = async ({ asset }, dest, onBytes) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, asset);
  onBytes(asset.length);
};

async function install(dir, manifest) {
  const previous = readInstalled(dir);
  const plan = await planSync(dir, manifest, previous);
  await applySync(dir, manifest, plan, fakeDownload);
  return plan;
}

test("installs, updates, removes, and respects player files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-sync-"));
  const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");

  await install(dir, { version: "1.0.0", files: [file("mods/a.jar", "a1"), file("mods/old.jar", "old"), file("options.txt", "opt1", { user: true })] });
  assert.equal(read("mods/a.jar"), "a1");
  assert.equal(read("options.txt"), "opt1");

  // Player tweaks options and adds their own mod.
  fs.writeFileSync(path.join(dir, "options.txt"), "mine");
  fs.writeFileSync(path.join(dir, "mods/own.jar"), "own");

  // Update: a changes, old removed, options carried forward unchanged.
  let plan = await install(dir, { version: "1.0.1", files: [file("mods/a.jar", "a2"), file("options.txt", "opt1", { user: true })] });
  assert.deepEqual(plan.download.map((f) => f.path), ["mods/a.jar"]);
  assert.equal(read("mods/a.jar"), "a2");
  assert.equal(fs.existsSync(path.join(dir, "mods/old.jar")), false);
  assert.equal(read("mods/own.jar"), "own");
  assert.equal(read("options.txt"), "mine");

  // A corrupted pack file gets repaired even without a version change.
  fs.writeFileSync(path.join(dir, "mods/a.jar"), "broken");
  plan = await install(dir, { version: "1.0.1", files: [file("mods/a.jar", "a2"), file("options.txt", "opt1", { user: true })] });
  assert.equal(read("mods/a.jar"), "a2");

  // Author ships new options: they replace the player's.
  await install(dir, { version: "1.0.2", files: [file("mods/a.jar", "a2"), file("options.txt", "opt2", { user: true })] });
  assert.equal(read("options.txt"), "opt2");
  assert.equal(readInstalled(dir).version, "1.0.2");
});

test("rejects paths outside the instance", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-sync-"));
  await assert.rejects(planSync(dir, { files: [file("../evil.txt", "x")] }, null), /Unsafe path/);
});

test("retries and rejects bad checksums", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-sync-"));
  const manifest = { version: "1", files: [{ path: "mods/a.jar", sha1: sha1("good"), size: 4, asset: "bad" }] };
  const plan = await planSync(dir, manifest, null);
  await assert.rejects(applySync(dir, manifest, plan, fakeDownload), /Checksum mismatch/);
  assert.equal(fs.existsSync(path.join(dir, "mods/a.jar")), false);
});
