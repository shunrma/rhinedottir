const test = require("node:test");
const assert = require("node:assert");
const { fetchJavaRuntimeManifest } = require("../src/main/game");

test("fetchJavaRuntimeManifest picks this platform's runtime and loads its file list", async (t) => {
  const key = { win32: "windows-x64", darwin: "mac-os", linux: "linux" }[process.platform];
  const index = { [key]: { "java-runtime-delta": [{ manifest: { url: "https://example.test/m.json" }, version: { name: "21.0.7" } }] } };
  const files = { "bin/java": { type: "file" } };
  t.mock.method(global, "fetch", async (url) => ({
    ok: true,
    json: async () => (url.endsWith("all.json") ? index : { files }),
  }));
  if (process.arch !== "x64") return;
  const result = await fetchJavaRuntimeManifest({ target: "java-runtime-delta" });
  assert.deepStrictEqual(result, { files, target: "java-runtime-delta", version: { name: "21.0.7" } });
});
