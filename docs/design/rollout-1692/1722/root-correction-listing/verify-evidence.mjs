import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const json = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = (bytes) => {
	const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
	return [hash(Buffer.from(lf)), hash(Buffer.from(lf.replaceAll("\n", "\r\n")))];
};
const quality = await json("quality.json");
const runtime = await json("runtime.json");
const units = await json("compatibility.json");
const pg = await json("verified-matrix.json");
assert.equal(units.testResults.length, 48);
assert.equal(units.numPassedTests, 1086);
assert.equal(units.numFailedTests, 0);
assert.equal(pg.testResults.length, 1);
assert.equal(pg.numPassedTests, 35);
assert.equal(pg.numFailedTests, 0);
assert.equal(pg.numPendingTests, 217);
assert.equal((await json("legacy-red-exact.json")).numFailedTests, 1);
assert.equal((await json("canonical-red.json")).numFailedTests, 4);
assert.equal((await json("types-command.json")).exitCode, 0);
const doctor = await json("doctor.json");
assert.equal(doctor.sourceRevision, quality.correctionCommit);
assert.equal(doctor.projects[0].scannedFileCount, 8);
assert.deepEqual(doctor.projects[0].diagnostics, []);
assert.equal(quality.biome.explicitLintImport.passed, true);
assert.equal(quality.biome.formatting.explicit100ColumnCRLF.passed, false);
assert.equal(quality.biome.formatting.normalCRLF.passed, false);
assert.equal(runtime.failure, undefined);
assert.equal(runtime.sourceCommit, quality.correctionCommit);
assert.equal(runtime.checks.length, 9);
assert.ok(runtime.checks.every((check) => check.passed));
assert.deepEqual(runtime.pageErrors, []);
assert.deepEqual(runtime.submission.admission, []);
assert.ok(runtime.submission.entries.every((entry) => entry.is_superseded && entry.superseded_by_id === null));
assert.equal(runtime.cancellation.requestStatus, "rejected");
assert.equal(runtime.cancellation.workPeriodUnchanged, true);
assert.ok(runtime.legacyHistoryQualification.includes("omits its legacy tombstone"));
assert.ok((await json("attempt-no-manager.json")).failure);
assert.ok((await json("attempt-status-label.json")).failure);
for (const [path, pin] of Object.entries(quality.sourcePins)) {
	const bytes = execFileSync("git", ["show", `${quality.correctionCommit}:${path}`], { cwd: repo });
	assert.ok(hashes(bytes).includes(pin), path);
	if (process.argv.includes("--current-source")) {
		assert.ok(hashes(await readFile(new URL(`../../../../../${path}`, import.meta.url))).includes(pin), path);
	}
}
const oldReader = execFileSync("git", ["show", `${runtime.reader.beforeCommit}:${runtime.reader.path}`], { cwd: repo });
assert.ok(hashes(oldReader).includes(runtime.reader.beforeSha256));
const newReader = execFileSync("git", ["show", `${quality.correctionCommit}:${runtime.reader.path}`], { cwd: repo });
assert.ok(hashes(newReader).includes(runtime.reader.afterSha256));
assert.equal(runtime.captures.length, 3);
for (const capture of runtime.captures) {
	assert.equal(hash(await readFile(new URL(capture.name, import.meta.url))), capture.sha256);
	assert.equal(capture.readerSha256, capture.name.startsWith("before-") ? runtime.reader.beforeSha256 : runtime.reader.afterSha256);
	assert.deepEqual(capture.css, { width: 1600, height: 1000 });
	assert.equal(capture.rootFont, "16px");
	assert.equal(capture.fonts, "loaded");
}
for (const probe of runtime.next) {
	const message = probe.result.find((item) => item.result)?.result.content.find((item) => item.type === "text");
	assert.deepEqual(JSON.parse(message.text), probe.name === "get_errors" ? { configErrors: [], sessionErrors: [] } : { issues: [] });
}
const cleanup = await json("cleanup.json");
assert.equal(cleanup.ownedNextIdentityVerified, true);
assert.equal(cleanup.portClosed, true);
assert.equal(cleanup.remainingOwnedContainers, 0);
const sharp = createRequire(new URL("../../../../../apps/webapp/package.json", import.meta.url))("sharp");
const pngs = (await readdir(new URL(".", import.meta.url))).filter((name) => name.endsWith(".png"));
assert.equal(pngs.length, 5);
for (const name of pngs) {
	const { info } = await sharp(await readFile(new URL(name, import.meta.url))).raw().toBuffer({ resolveWithObject: true });
	assert.ok(info.width > 0 && info.height > 0);
	const capture = runtime.captures.find((item) => item.name === name);
	if (capture) assert.deepEqual(capture.png, { width: info.width, height: info.height });
}
console.log("Verified 48/1086 units,35 PostgreSQL cases,exact red artifacts,source pins,three accepted/two failed decoded captures,actual cancellation and cleanup. Legacy deleted-entry history and formatter/global limits remain unpassed; this is an archive check,not a new runtime run.");
