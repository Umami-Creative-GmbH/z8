// Compare pre-R007 and current broad files with identical normalized file/config boundaries.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
const baseRef = "1c8d3e5b0c185ab6546236b2e39726b28f98b1c1";
const files = ["src/lib/analytics/types.ts", "src/lib/effect/services/analytics.service.ts"];
const normalize = text => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const scan = file => {
  const args = ["exec", "biome", "check", file, "--reporter=json", "--line-ending=lf"];
  const executable = process.env.npm_execpath;
  assert.ok(executable);
  const result = spawnSync(executable.endsWith(".exe") ? executable : process.execPath, executable.endsWith(".exe") ? args : [executable, ...args], { cwd: resolve("apps/webapp"), encoding: "utf8", windowsHide: true });
  assert.ok(result.status === 0 || result.status === 1);
  return JSON.parse(result.stdout).diagnostics.map(({ category, severity }) => ({ category, severity })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const results = [];
for (const file of files) {
  assert.ok(file.endsWith(".ts"));
  const actualPath = resolve("apps/webapp", file);
  const basePath = resolve("apps/webapp", file.slice(0, -3) + ".baseline-1705.ts");
  const currentPath = resolve("apps/webapp", file.slice(0, -3) + ".current-1705.ts");
  assert.notEqual(basePath, actualPath);
  assert.notEqual(currentPath, actualPath);
  const before = execFileSync("git", ["show", baseRef + ":apps/webapp/" + file], { encoding: "utf8", windowsHide: true });
  const after = await readFile(actualPath, "utf8");
  let baseCreated = false, currentCreated = false;
  try {
    await writeFile(basePath, normalize(before), { flag: "wx" }); baseCreated = true;
    await writeFile(currentPath, normalize(after), { flag: "wx" }); currentCreated = true;
    const baseline = scan(basePath), current = scan(currentPath);
    assert.deepEqual(current, baseline);
    results.push({ file, unchanged: true, diagnostics: current });
  } finally {
    if (currentCreated) await unlink(currentPath);
    if (baseCreated) await unlink(basePath);
  }
}
await writeFile("docs/design/rollout-1692/1705/biome-baseline-root.json", JSON.stringify({ baseRef, results }, null, 2) + "\n");
console.log("Normalized pre-R007/current Biome category and severity parity verified.");
