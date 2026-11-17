import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Read-only: never regenerates a historical archive or updates its hashes.
const directory = fileURLToPath(new URL("./", import.meta.url));
const read = (name) => JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = read("source.json");
for (const file of [...source.owned, ...source.preserved]) {
	const bytes = readFileSync(file.path, "utf8").replace(/\r\n/g, "\n");
	assert.equal(sha(bytes), file.canonicalSha256, file.path);
}
for (const file of read("manifest.json").artifacts) {
	const bytes = readFileSync(file.path);
	if (sha(bytes) === file.sha256) continue;
	// Git's core.autocrlf changes text checkout bytes. Binary evidence stays exact.
	assert.match(file.path, /\.(?:json|mjs|md|diff|txt)$/);
	assert.equal(sha(bytes.toString("utf8").replace(/\r\n/g, "\n")), file.canonicalSha256, file.path);
}
for (const name of readdirSync(`${directory}/logs`)) {
	if (name.endsWith(".gz")) gunzipSync(readFileSync(`${directory}/logs/${name}`));
}
const runtime = read("runtime.json");
assert.equal(runtime.finished, true);
assert.equal(read("runtime-extra.json").finished, true);
for (const capture of runtime.captures.filter((x) => x.path.startsWith("after-"))) {
	for (const file of capture.source) {
		assert.equal(file.sha256, source.owned.find((x) => x.path === file.path)?.sha256, file.path);
	}
}
const unit = read("unit-results.json");
assert.equal(unit.testResults.length, 8);
assert.equal(unit.numPassedTests, 84);
assert.equal(read("doctor.json").summary.totalDiagnosticCount, 0);
assert.ok(read("final-types.json").every((x) => x.exit === 0));
assert.ok(read("cleanup.json").containers.every((x) => x.absent));
console.log("Source, artifact hashes, compressed logs and recorded outcomes verified (read-only).");
