import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("index measurement requires an explicit reviewed output before starting disposable services", () => {
	const command = fileURLToPath(
		new URL("./absence-indexes.mjs", import.meta.url),
	);
	const result = spawnSync(process.execPath, [command], { encoding: "utf8" });
	assert.equal(result.status, 2);
	assert.match(result.stderr, /absolute.*output/);
});
