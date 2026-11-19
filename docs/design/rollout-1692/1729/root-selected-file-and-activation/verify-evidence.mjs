#!/usr/bin/env node
// Read-only verifier. It never imports an archived driver or runs a test.
// Default verifies immutable Git at SOURCE. --current-source additionally compares
// the checked-out source's LF bytes; legitimate later tickets may fail that opt-in.
// The sealed public index is an explicit allowlist; private evidence is never read.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const SOURCE = "e4d08accbee9b37b2f7bc5068a197f62f74c47a1";
const MERGE = "e1e25677696ad9dce26b77e1fcb7047db8b2fe1c";
const PRE_DELETE = "ed1841d161a448561b329fae43903b0a2e606dfa";
const VERIFIED = "e50692c3bc5194ab1c16d2fe8d12664ab11aafd7";
const SEALS = {
  "source-pins.json": "ac5b570254d72a6971676eb3a696182db14a304c610981d2093cc4750b24beb6",
  "verification-manifest.json": "f03b10a5473af92203317fa6dc78bbdbc01dd7d4409ec40217e541bfef8e590d",
  "evidence-index.json": "781fd7ca7208a64a44fda94e9bced4b087221b27e6da84f6dc98aebd8954aac6",
  "publication-exclusions.json": "2365550f88f924edf7696a5f1de0bb1694cb80d8080a33aaaa87ad8bafd0b4a5",
  "README.md": "d5950d4b61dcea85f543cf27f29a4e86072737d04a5338d3d312a9c749680fb7",
  ".gitattributes": "705fd4d6451a31d36b3df7de96f83f30ac976c9b4a6d1e51671d8e2f33e2d0da",
};
const sha = value => createHash("sha256").update(value).digest("hex");
const lf = value => value.toString("utf8").replaceAll("\r\n", "\n");
const flags = new Set(process.argv.slice(2));
assert.ok([...flags].every(flag => flag === "--current-source"), "Unknown flag");
const archive = dirname(fileURLToPath(import.meta.url));
let repo = archive;
while (!existsSync(join(repo, ".git"))) {
  const parent = dirname(repo);
  assert.notEqual(parent, repo, "Place the archive inside its Git checkout");
  repo = parent;
}
const archiveReal = realpathSync(archive);
const forbidden = /private|credential|cookie|pointer|storage[-_]?state|(?:^|[/.])auth(?:[/.]|$)/i;
function safeRelative(path) {
  assert.equal(typeof path, "string");
  assert.ok(path && !isAbsolute(path) && !/[:\\\x00-\x1f]/.test(path), "Unsafe path");
  assert.ok(path.split("/").every(part => part && part !== "." && part !== ".."), "Unsafe path component");
  assert.ok(!forbidden.test(path), "Forbidden artifact category; do not stat/read/hash it");
  return path;
}
function publicFile(path) {
  safeRelative(path);
  const absolute = join(archive, path);
  const resolved = realpathSync(absolute);
  const rel = relative(archiveReal, resolved);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), "Archive path escapes its directory");
  assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink(), "Expected a regular public file");
  return readFileSync(absolute);
}
function parse(bytes) { return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
for (const [path, digest] of Object.entries(SEALS)) {
  assert.match(digest, /^[a-f0-9]{64}$/, "Unsealed draft: final review must supply all seals");
  assert.equal(sha(publicFile(path)), digest, path);
}
const pins = parse(publicFile("source-pins.json"));
const manifest = parse(publicFile("verification-manifest.json"));
const index = parse(publicFile("evidence-index.json"));
const exclusions = parse(publicFile("publication-exclusions.json"));
assert.equal(manifest.state, "SEALED_PUBLIC");
assert.equal(manifest.source, SOURCE);
assert.equal(manifest.runtime.status, "audited-after-release");
assert.equal(manifest.quality14.status, "recorded-after-release");
assert.equal(pins.source, SOURCE);
assert.equal(pins.merge, MERGE);
assert.equal(pins.preDelete, PRE_DELETE);
assert.equal(pins.verified, VERIFIED);
assert.equal(pins.pins.length, 22);
assert.equal(pins.incomingPaths.length, 13);
assert.equal(pins.rootChangedPaths.length, 6);
assert.equal(pins.preserved1728Paths.length, 8);

// The public index has no private entries, private hashes, or private filenames.
// Exclusions identify categories and reasons only. No excluded path is touched.
assert.equal(index.schemaVersion, 1);
assert.ok(Array.isArray(index.files) && index.files.length > 0);
assert.equal(index.digest, sha(JSON.stringify(index.files)));
const allowed = new Map(index.files.map(item => {
  safeRelative(item.path);
  assert.ok(/^(checks|controls|runtime|support)\//.test(item.path), "Index may contain only reviewed public evidence");
  assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0);
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
  return [item.path, item];
}));
assert.equal(allowed.size, index.files.length, "Duplicate archive paths");
assert.equal(exclusions.policy, "category-only; no private filenames, sizes, hashes, or reads");
assert.ok(Array.isArray(exclusions.categories) && exclusions.categories.length > 0);
for (const item of exclusions.categories) assert.ok(typeof item.category === "string" && typeof item.reason === "string");
function read(path) {
  assert.ok(allowed.has(safeRelative(path)), "Artifact is not on the sealed public allowlist: " + path);
  return publicFile(path);
}
const json = path => parse(read(path));
const text = path => {
  const bytes = read(path);
  return bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8").replace(/^\uFEFF/, "");
};
for (const item of index.files) {
  const bytes = read(item.path);
  assert.equal(bytes.length, item.bytes, item.path);
  assert.equal(sha(bytes), item.sha256, item.path);
  if (item.path.endsWith(".json")) parse(bytes);
  if (item.path.endsWith(".png")) decodePng(bytes);
}

// Fixed Git blobs are authoritative; no working-tree status is a default gate.
const git = args => execFileSync("git", ["--no-optional-locks", "-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
const gitText = args => git(args).toString("utf8").trim();
const blob = (ref, path) => git(["show", ref + ":" + path]);
assert.equal(gitText(["rev-parse", SOURCE + "^"]), PRE_DELETE);
assert.equal(gitText(["rev-parse", PRE_DELETE + "^"]), MERGE);
assert.deepEqual(gitText(["rev-list", "--parents", "-n", "1", MERGE]).split(" ").slice(1), [
  "cab40dcbb6ea69cefb7aa919228298a881a66060", "8e14fcb945ccc6d0e5075407b00def0ed1050391",
]);
git(["merge-base", "--is-ancestor", VERIFIED, SOURCE]);
for (const pin of pins.pins) {
  safeRelative(pin.path);
  const bytes = blob(SOURCE, pin.path);
  assert.equal(gitText(["rev-parse", SOURCE + ":" + pin.path]), pin.gitBlob, pin.path);
  assert.equal(bytes.length, pin.bytes, pin.path);
  assert.equal(sha(bytes), pin.sha256, pin.path);
  assert.equal(sha(lf(bytes)), pin.lfSha256, pin.path);
  if (flags.has("--current-source")) {
    // CRLF checkouts are allowed. This opt-in intentionally catches later source changes.
    assert.equal(sha(lf(readFileSync(join(repo, pin.path)))), pin.lfSha256, "Current LF source: " + pin.path);
  }
}
function tree(ref) {
  return new Map(git(["ls-tree", "-r", "-z", ref]).toString("utf8").split("\0").filter(Boolean).map(line => {
    const at = line.indexOf("\t"); return [line.slice(at + 1), line.slice(0, at)];
  }));
}
const oldTree = tree(MERGE), sourceTree = tree(SOURCE);
const changed = [];
for (const [path, entry] of oldTree) {
  assert.ok(sourceTree.has(path), "Root correction removed a merged path: " + path);
  if (sourceTree.get(path) !== entry) changed.push(path);
}
for (const path of sourceTree.keys()) if (!oldTree.has(path)) changed.push(path);
assert.deepEqual(changed.sort(), [...pins.rootChangedPaths].sort());
for (const path of pins.preserved1728Paths) {
  assert.deepEqual(blob(SOURCE, path), blob(MERGE, path), path);
  assert.deepEqual(blob(SOURCE, path), blob(VERIFIED, path), path);
}
for (const [prefix, count] of [
  ["docs/design/rollout-1692/1728/root-lifecycle-and-snapshot/", 163],
  ["docs/design/rollout-1692/1835/", 203], ["docs/design/rollout-1692/1737/", 211],
  ["docs/design/rollout-1692/1736/", 266],
]) {
  const entries = [...oldTree].filter(([path]) => path.startsWith(prefix));
  assert.equal(entries.length, count, prefix);
  for (const [path, entry] of entries) assert.equal(sourceTree.get(path), entry, path);
}
const workerEntries = [...oldTree].filter(([path]) => path === "docs/design/rollout-1692/1729.md" || path.startsWith("docs/design/rollout-1692/1729/"));
assert.equal(workerEntries.length, 170);
for (const [path, entry] of workerEntries) assert.equal(sourceTree.get(path), entry, path);

// Physical path + full name + same-name occurrence. Nested suite totals are not files.
function cases(result) {
  const seen = new Map();
  return result.testResults.flatMap(file => {
    const normalized = file.name.replaceAll("\\", "/");
    const start = normalized.indexOf("/apps/webapp/");
    const physical = start >= 0 ? normalized.slice(start + 1) : normalized.slice(normalized.indexOf("/.tmp/") + 1);
    assert.ok(physical.startsWith("apps/webapp/") || physical.startsWith(".tmp/"), "Unknown physical test origin");
    return file.assertionResults.map(item => {
      const base = physical + "\0" + item.fullName;
      const occurrence = (seen.get(base) ?? 0) + 1; seen.set(base, occurrence);
      return { file: physical, fullName: item.fullName, key: base + "\0" + occurrence, status: item.status };
    });
  });
}
function expectRun(path, total, passed, failed, physicalFiles) {
  const result = json(path), rows = cases(result);
  assert.deepEqual([rows.length, rows.filter(x => x.status === "passed").length, rows.filter(x => x.status === "failed").length], [total, passed, failed], path);
  assert.equal(new Set(rows.map(x => x.key)).size, total, path);
  assert.equal(new Set(rows.map(x => x.file)).size, physicalFiles, path);
  assert.equal(result.numPendingTests, 0, path);
  assert.equal(result.numTodoTests, 0, path);
  assert.equal(result.success, failed === 0, path);
  return rows;
}
expectRun("controls/selected-public-probe.json", 5, 2, 3, 1);
expectRun("controls/arrival-red.json", 8, 2, 6, 1);
expectRun("controls/arrival-green.json", 19, 19, 0, 3);
expectRun("controls/activation/delete-activation-01.json", 3, 1, 2, 1);
expectRun("controls/activation/delete-activation-02.json", 3, 1, 2, 1);
expectRun("controls/delete-red.json", 5, 2, 3, 1);
expectRun("controls/delete-green.json", 5, 4, 1, 1);
expectRun("controls/delete-green-final.json", 5, 4, 1, 1);
expectRun("controls/delete-green-03.json", 5, 5, 0, 1);
const focused = expectRun("checks/delete-default-prevented.json", 5, 5, 0, 1);
const unit = expectRun("checks/unit-final-02.json", 175, 175, 0, 25);
const pg = expectRun("runtime/postgres.json", 163, 163, 0, 9);
assert.equal(new Set([...unit, ...pg].map(x => x.key)).size, 338);
assert.equal(new Set([...unit, ...pg].map(x => x.file)).size, 34);
for (const item of focused) assert.ok(unit.some(other => item.key === other.key), "Focused rerun is nonadditive");
const activation = json("controls/activation/delete-activation-handoff.json");
assert.equal(activation.head, PRE_DELETE);
for (const item of activation.artifactHashes) {
  const path = "controls/activation/" + safeRelative(item.file);
  assert.equal(read(path).length, item.bytes, path);
  assert.equal(sha(read(path)), item.sha256, path);
}
// Their recorded raw pins may have CRLF. Compare the shared canonical text where
// the handoff offers it; do not relabel its pre-fix source as final source.
assert.match(text("controls/activation/delete-activation.public.test.tsx"), /not\.toHaveBeenCalled\(\)/);
const dialog = lf(blob(SOURCE, "apps/webapp/src/components/personnel-file/delete-document-dialog.tsx"));
const dialogTests = lf(blob(SOURCE, "apps/webapp/src/components/personnel-file/delete-document-dialog.test.tsx"));
assert.match(dialog, /event\.preventDefault\(\)/);
assert.match(dialog, /onSubmitMeta: defaultSubmission/);
assert.match(dialog, /meta\.arrival !== lifetime\.current/);
assert.match(dialogTests, /new Event\("submit", \{ bubbles: true, cancelable: true \}\)/);
assert.match(dialogTests, /expect\(submission\.defaultPrevented\)\.toBe\(true\)/);
for (const count of [1, 2, 3]) assert.ok(dialogTests.includes("toHaveBeenCalledTimes(" + count + ")"));
const typeLog = text("checks/typecheck-final-02.log");
for (const config of ["tsconfig.typecheck.json", "tsconfig.workflow-contracts.json", "tsconfig.smoke.json"]) assert.ok(typeLog.includes(config));
assert.match(typeLog, /Types generated successfully/);
assert.match(text("checks/biome-root-final.log"), /Checked 6 files/);
const doctor = text("checks/doctor-final.log");
assert.match(doctor, /Scanned 14 files/);
assert.match(doctor, /1 issue/);
assert.match(doctor, /Bugs: 1 warning/);
assert.match(doctor, /tanstack-form-on-submit-requires-prevent-default/);
assert.equal(manifest.doctor.errors, 0);
assert.equal(manifest.doctor.warnings, 1);
assert.equal(manifest.doctor.review, "false-positive: explicit preventDefault plus cancelable submit-event assertion");

assert.equal(manifest.runtime.contractsImplemented, true, "Runtime contracts require final public handoff review");
assert.equal(manifest.runtime.contractVersion, "1729-public-fields-v1");
assert.equal(publicFile(".gitattributes").toString("utf8"), "* -text\n");
const quality = json("checks/quality-all14.json");
assert.equal(quality.source, SOURCE);
assert.equal(quality.files.length, 14);
assert.equal(quality.format.exitCode, 1);
assert.equal(quality.lint.exitCode, 0);
assert.match(text("checks/biome-all14-format.log"), /Found 8 errors/);
assert.match(text("checks/biome-all14-lint.log"), /Found 1 warning/);
assert.match(text("checks/biome-all14-lint.log"), /suppressions\/unused/);
assert.deepEqual([manifest.quality14.formatErrors, manifest.quality14.lintWarnings], [8, 1]);

// Released runtime seal: copy only its 73 explicit public entries, byte for byte.
const runtimeSeal = json("runtime/artifact-hashes.json");
assert.equal(runtimeSeal.head, SOURCE);
assert.equal(runtimeSeal.publicArtifactDigests.length, 73);
assert.equal(runtimeSeal.publicArtifactDigests.filter(x => x.file.endsWith(".png")).length, 31);
for (const item of runtimeSeal.publicArtifactDigests) {
  const path = "runtime/" + safeRelative(item.file);
  assert.equal(read(path).length, item.bytes, path);
  assert.equal(sha(read(path)), item.sha256, path);
}
const released = json("runtime/verification-manifest.json");
assert.equal(released.head, SOURCE);
assert.equal(released.branch, "fix/1729-selected-file-snapshot");
assert.equal(released.trackedClean, true);
assert.equal(released.source.length, 17);
assert.equal(released.dependencies.links, 158);
assert.equal(released.dependencies.physicalParents, 3);
assert.equal(released.dependencies.unchanged, true);
assert.equal(released.configuration.length, 6);
for (const pin of released.configuration) {
  assert.equal(pin.unchanged, true);
  const bytes = blob(SOURCE, safeRelative(pin.path));
  assert.ok([sha(bytes), sha(lf(bytes).replaceAll("\n", "\r\n"))].includes(pin.sha256), "Git/config checkout encoding: " + pin.path);
}
const runtimePins = new Map(released.source.map(pin => [pin.path, pin]));
assert.equal(runtimePins.size, 17);
for (const pin of released.source) assert.equal(sha(lf(blob(SOURCE, safeRelative(pin.path)))), pin.lf, pin.path);
function sourceProof(source, historical = false) {
  assert.equal(source.head, SOURCE);
  assert.equal(source.pins.length, 12);
  assert.equal(source.digest, sha(JSON.stringify(source.pins)));
  for (const pin of source.pins) {
    const wanted = historical && overlayByPath.has(pin.path) ? overlayByPath.get(pin.path) : runtimePins.get(pin.path);
    assert.ok(wanted, pin.path);
    if (historical && overlayByPath.has(pin.path)) {
      assert.equal(pin.raw, wanted.historicalRaw, pin.path);
      assert.equal(pin.lf, sha(lf(blob(HISTORICAL, pin.path))), pin.path);
    } else {
      assert.equal(pin.raw, wanted.raw, pin.path);
      assert.equal(pin.lf, wanted.lf, pin.path);
    }
  }
}
const HISTORICAL = "cab40dcbb6ea69cefb7aa919228298a881a66060";
const applied = json("runtime/overlay-applied.json");
const restored = json("runtime/overlay-restored.json");
assert.equal(applied.ref, HISTORICAL);
assert.equal(applied.head, SOURCE);
assert.equal(applied.pins.length, 7);
assert.equal(applied.unusedNewHelpers.length, 2);
assert.match(applied.qualification, /server stopped before overlay/);
const overlayByPath = new Map(applied.pins.map(pin => [pin.path, pin]));
assert.equal(overlayByPath.size, 7);
for (const pin of applied.pins) {
  assert.equal(pin.currentRaw, runtimePins.get(pin.path).raw, pin.path);
  assert.equal(pin.historicalRaw, sha(blob(HISTORICAL, pin.path)), pin.path);
}
sourceProof(applied.before);
sourceProof(applied.after, true);
assert.equal(restored.byteExact, true);
assert.equal(restored.head, SOURCE);
sourceProof(restored.after);
assert.deepEqual(restored.after, applied.before);
for (const file of ["next-stop-before-overlay.json", "next-stop-after-overlay.json", "next-stop-final.json"]) {
  const stop = json("runtime/" + file);
  assert.equal(stop.portClosed, true, file);
}
const started = json("runtime/source-start.json");
assert.equal(started.head, SOURCE);
assert.equal(started.pins.length, 9);
assert.equal(started.links.length, 158);
assert.equal(started.physical.length, 3);
assert.equal(started.configs.length, 5);
for (const pin of started.configs) assert.equal(released.configuration.find(x => x.path === pin.path)?.sha256, pin.sha256, pin.path);
assert.equal(activation.configuration.length, 6);
for (const pin of released.configuration) assert.equal(activation.configuration.find(x => x.path === pin.path)?.sha256, pin.sha256, pin.path);
for (const pin of started.pins) {
  assert.equal(pin.raw, runtimePins.get(pin.path).raw, pin.path);
  assert.equal(pin.lf, runtimePins.get(pin.path).lf, pin.path);
}

// Failure artifacts retain their actual outcome. Journey04 has useful early
// read checks, followed by an unactivated pointer Save; only journey05 accepts Save.
for (const [name, match] of [
  ["journey-01.json", /requires 7/], ["journey-02.json", /Personnel number/],
  ["journey-03.json", /Scoped readback timeout/], ["journey-04.json", /Waiting for selector/],
]) {
  const failed = json("runtime/" + name);
  sourceProof(failed.source);
  assert.match(failed.failure.message, match, name);
}
assert.match(text("runtime/attempt-01-pnpm-engine-lock.txt"), /ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK/);
const readJourney = json("runtime/journey-04.json");
sourceProof(readJourney.source);
assert.equal(readJourney.ready.h1.length, 1);
assert.equal(readJourney.ready.h1[0], "Person 2");
assert.ok(readJourney.held.reads.length > 0);
for (const reader of readJourney.held.reads) assert.ok(reader.blockers.includes(readJourney.held.lockPid));
assert.match(readJourney.checks[2], /held\/canceled.*local Retry recovers/);
assert.match(readJourney.checks[3], /refetch failure retains document rows.*local Retry recovers/);
assert.equal(readJourney.transport.filter(x => x.stage === "settled-late-save" && /^\/en\/personnel-files\//.test(x.path)).length, 0);
const roles = json("runtime/journey-05.json");
assert.equal(roles.stage, "complete");
assert.equal(roles.checks.length, 4);
assert.equal(roles.errors.length, 0);
sourceProof(roles.source);
sourceProof(roles.sourceEnd);
assert.deepEqual(roles.sourceEnd, roles.source);
assert.equal(roles.grant.scope, "specific");
assert.deepEqual(roles.grant.categories, ["certificate"]);
assert.equal(roles.grant.employees.length, 1);
assert.match(roles.checks[2], /category and own-file denial.*nonofficer/);
assert.deepEqual(roles.afterDraft, roles.beforeDraft);
assert.ok(roles.beforeDraft.title.includes("authority-lost-"));
assert.equal(roles.beforeDraft.fields.length, 5);
assert.ok(roles.beforeDraft.fields.some(x => x.tag === "INPUT" && x.value === roles.beforeDraft.title));
assert.ok(roles.beforeDraft.fields.every(x => x.disabled === false));
assert.equal(roles.matchingWrites, 0);
const target = roles.grant.employees[0].employee_id;
assert.ok(roles.lateTransport.some(x => x.stage === "settled-late-save" && x.path === "/en/personnel-files/" + target && x.status === 200));
assert.match(roles.checks[3], /Save refused.*exact visible draft retained.*zero scoped matching writes.*reload denied/);
const roleDriver = text("runtime/roles.mjs");
assert.match(roleDriver, /submit\.focus\(\).*keyboard\.press\('Enter'\)/);
assert.match(roleDriver, /organization_id=\$1 and employee_id=\$2 and title=\$3/);
assert.match(roleDriver, /assert\.deepEqual\(result.afterDraft,result.beforeDraft\)/);

const binary = json("runtime/binary.json");
sourceProof(binary.source);
assert.equal(binary.stage, "complete");
assert.equal(binary.checks.length, 7);
assert.equal(binary.errors.length, 0);
assert.equal(binary.document.category, "certificate");
assert.equal(Number(binary.document.size_bytes), 68);
assert.equal(binary.downloads.length, 2);
for (const [i, size] of [68, 274].entries()) {
  const download = binary.downloads[i];
  assert.equal(download.state, "completed");
  for (const key of ["totalBytes", "receivedBytes", "length"]) assert.equal(download[key], size);
}
assert.equal(binary.downloads[0].urlPath, "/api/personnel-files/documents/" + binary.document.id);
assert.match(binary.zipHref, /sharedOnly=1$/);
assert.equal(binary.zipEntries.length, 1);
assert.equal(binary.zipEntries[0].bytes, 68);
assert.equal(binary.zipEntries[0].sha256, binary.downloads[0].sha256);
const uploadedPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
assert.equal(sha(uploadedPng), binary.downloads[0].sha256);
assert.match(binary.checks[3], /metadata Save persisted exact scoped title/);
assert.match(binary.checks[6], /Delete Cancel preserves record.*reasoned public deletion/);
assert.match(text("runtime/binary.mjs"), /assert\.deepEqual\(entries\[0\]\.content,png\)/);

const phones = json("runtime/phones.json");
sourceProof(phones.source);
assert.equal(phones.status, "passed");
assert.equal(phones.errors.length, 0);
assert.equal(phones.restoredTitle, true);
assert.equal(phones.geometry.length, 4);
assert.deepEqual(phones.geometry.map(x => [x.actor, x.dark]), [["small-admin", false], ["small-admin", true], ["small-employee", false], ["small-employee", true]]);
for (const observation of phones.geometry) {
  assert.equal(observation.width, 390);
  assert.ok(observation.rows.length > 0);
  for (const row of observation.rows) {
    assert.ok(row.textWidth >= 200);
    for (const action of row.actions) {
      assert.ok(action.x >= 0 && action.right <= 390);
      assert.ok(action.width >= 32 && action.height >= 32);
    }
  }
}
assert.equal(phones.focusAfterEscape.tag, "BUTTON");
assert.equal(phones.captures.length, 6);
for (const capture of phones.captures) assert.equal(capture.font, "18px");
assert.match(text("runtime/phones.mjs"), /click\(p,'Large','\[role=menuitemradio\]'\)/);
assert.match(text("runtime/phones.mjs"), /reload\(\{waitUntil:'domcontentloaded'\}\).*fontSize==='18px'/);

const native = json("runtime/native.json");
sourceProof(native.source);
assert.equal(native.status, "actual-target-tree-observed");
assert.deepEqual(native.auth, {code: 0, signIn: 200, active: 200});
assert.equal(native.harnessSha256, sha(read("runtime/native.mjs")));
assert.equal(native.close.code, 0);
const nativeClose = JSON.parse(native.close.out.trim());
assert.equal(nativeClose.success, true);
assert.equal(nativeClose.data.closed, true);
for (const name of ["open", "target", "wait", "tree", "snapshot"]) {
  const command = native.commands.find(x => x.name === name);
  assert.equal(command.code, 0, name);
  const result = JSON.parse(command.out.trim());
  assert.equal(result.success, true, name);
  const lifecycle = result.data?.lifecycle;
  if (lifecycle) {
    assert.ok(["not_configured", "not_attempted"].includes(lifecycle.restoreStatus));
    assert.ok(["not_configured", "not_attempted"].includes(lifecycle.saveStatus));
  }
}
assert.match(native.commands.find(x => x.name === "tree").out, /EmployeeFileWorkspace/);
assert.match(native.commands.find(x => x.name === "tree").out, /PersonnelFilePanel/);
// Retain the ancillary Notification probe failure; it is not a passed check.
assert.equal(native.commands.find(x => x.name === "permission").code, 1);
assert.match(native.commands.find(x => x.name === "permission").out, /Notification is not defined/);

function nextProof(next) {
  for (const name of ["get_project_metadata", "get_page_metadata", "get_compilation_issues", "get_errors", "get_routes"]) assert.ok(next.available.includes(name));
  const observation = name => {
    const entry = next.observations.find(x => x.name === name);
    assert.ok(entry && !entry.response.error, name);
    return entry.response.result.content.filter(x => x.type === "text").map(x => JSON.parse(x.text));
  };
  assert.deepEqual(observation("get_compilation_issues"), [{issues: []}]);
  assert.deepEqual(observation("get_errors"), [{configErrors: [], sessionErrors: []}]);
  const sessions = observation("get_page_metadata").flatMap(x => x.sessions);
  const selected = sessions.find(x => x.url === "/en/personnel-files/" + target && x.segments.some(segment => segment.path === "app/[locale]/(app)/personnel-files/[employeeId]/page.tsx" && segment.type === "page"));
  assert.ok(selected);
  assert.equal(selected.routerType, "app");
  assert.ok(selected.segments.some(x => x.path === "app/[locale]/(app)/personnel-files/[employeeId]/page.tsx" && x.type === "page"));
  assert.ok(observation("get_routes").some(x => x.appRouter.includes("/[locale]/personnel-files/[employeeId]")));
}
nextProof(roles.next);
const smoke = json("runtime/restored-smoke.json");
sourceProof(smoke.source);
assert.equal(smoke.status, "restored-current-route-and-captures-verified");
assert.equal(smoke.browserClosed, true);
assert.deepEqual(smoke.errors, []);
nextProof(smoke.next);
assert.equal(smoke.decodedCaptures.length, 31);
for (const image of smoke.decodedCaptures) {
  assert.equal(sha(read("runtime/" + safeRelative(image.name))), image.sha256);
  assert.ok(image.width > 0 && image.height > 0);
  assert.equal(image.decodedBytes, image.width * image.height * 4);
}

const before = json("runtime/matched-before.json"), current = json("runtime/matched-current.json");
sourceProof(before.source, true);
sourceProof(current.source);
assert.equal(before.phase, "before");
assert.equal(current.phase, "current");
assert.match(before.qualification, /Partial application boundary/);
assert.deepEqual(before.records, current.records);
assert.equal(current.records.length, 3);
for (const result of [before, current]) {
  assert.equal(result.status, "captured");
  assert.deepEqual(result.errors, []);
  assert.equal(result.captures.length, 3);
  assert.deepEqual(result.captures.map(x => [x.viewport.width, x.viewport.height]), [[1600,1000],[390,844],[2400,1200]]);
  for (const capture of result.captures) {
    assert.equal(capture.path, "/en/personnel-files/" + target);
    assert.equal(capture.documentWidth, capture.viewport.width);
    assert.equal(capture.font, "16px");
    assert.equal(capture.fontStatus, "loaded");
    assert.equal(capture.screenshotViewportOnly, true);
    assert.equal(capture.dialogs, 0);
    assert.equal(sha(read("runtime/" + safeRelative(capture.file))), capture.sha256);
    assert.deepEqual(capture.h1, result === before ? ["Z8", "Person 2"] : ["Person 2"]);
  }
}
// Captures are viewport evidence, not full-page, occlusion, performance, or device certification.
for (const name of ["journey-01.json", "journey-02.json", "journey-03.json", "journey-04.json", "journey-05.json", "binary.json", "phones.json"]) {
  const result = json("runtime/" + name);
  for (const capture of result.captures) assert.equal(sha(read("runtime/" + safeRelative(capture.file))), capture.sha256);
}
const cleanup = json("runtime/cleanup.json");
assert.deepEqual(cleanup, released.cleanup);
assert.equal(cleanup.exactManifestContainersAbsent, 3);
assert.equal(cleanup.verifiedStoppedPidCount, 18);
assert.equal(cleanup.ownedNextPortClosed, true);
assert.equal(cleanup.nativeDaemonAbsent, true);
assert.equal(cleanup.nativeClosed, true);
assert.equal(cleanup.cacheMoved, false);
assert.match(cleanup.processInventory, /Exact task manifest PIDs only/);
assert.deepEqual(released.intentionalDevWrapperExits, [1, 1, 1]);

// Public filenames and obvious static secret patterns only. This is deliberately
// not a scan/read/hash of private evidence or a cryptographic authentication audit.
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk_live_|sk_test_|ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  /postgres(?:ql)?:\/\/[^\s'"<>]+:[^\s'"<>]+@/i,
  /Authorization["']?\s*[:=]\s*["']Bearer [A-Za-z0-9._~+/-]{20,}/i,
];
for (const item of index.files) if (!item.path.endsWith(".png")) for (const pattern of secretPatterns) assert.ok(!pattern.test(text(item.path)), "Obvious static secret pattern: " + item.path);
console.log(JSON.stringify({status:"verified",source:SOURCE,currentSourceChecked:flags.has("--current-source"),publicArtifacts:index.files.length,pngs:31,uniqueCases:338,physicalFiles:34,focusedNonadditive:true,formatErrors:8,lintWarnings:1,doctorWarnings:1,privateEvidenceRead:false}));

// Built-in PNG scanline decode: validates CRC, zlib stream, every filter/pass and
// consumed bytes, with no package installation or archived code execution.
function decodePng(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "PNG signature");
  let offset = 8, header, ended = false, palette = false;
  const streams = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, "PNG chunk header");
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    assert.ok(end <= bytes.length, "PNG chunk length");
    const type = bytes.toString("ascii", offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), "PNG CRC " + type);
    if (type === "IHDR") { assert.equal(header, undefined); assert.equal(length, 13); header = Buffer.from(data); }
    if (type === "PLTE") palette = true;
    if (type === "IDAT") streams.push(data);
    if (type === "IEND") { assert.equal(length, 0); ended = true; offset = end; break; }
    offset = end;
  }
  assert.ok(header && ended && streams.length); assert.equal(offset, bytes.length);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), depth = header[8], color = header[9], interlace = header[12];
  assert.ok(width > 0 && height > 0 && width * height <= 100000000);
  assert.equal(header[10], 0); assert.equal(header[11], 0); assert.ok(interlace === 0 || interlace === 1);
  const channels = {0:1,2:3,3:1,4:2,6:4}[color];
  assert.ok(channels && ({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color].includes(depth)));
  if (color === 3) assert.ok(palette, "Indexed PNG palette missing");
  const raw = inflateSync(Buffer.concat(streams), { maxOutputLength: 1024 * 1024 * 1024 });
  let cursor = 0;
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  for (const [x,y,dx,dy] of passes) {
    const w = Math.max(0, Math.ceil((width-x)/dx)), h = Math.max(0, Math.ceil((height-y)/dy));
    if (!w || !h) continue;
    const stride = Math.ceil(w * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8));
    let prior = Buffer.alloc(stride);
    for (let row = 0; row < h; row++) {
      assert.ok(cursor + 1 + stride <= raw.length, "PNG scanline length");
      const filter = raw[cursor++]; assert.ok(filter <= 4, "PNG filter");
      const current = Buffer.from(raw.subarray(cursor, cursor + stride)); cursor += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? current[i-bpp] : 0, b = prior[i], c = i >= bpp ? prior[i-bpp] : 0;
        const p = a+b-c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
        const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        current[i] = (current[i] + predictor) & 255;
      }
      prior = current;
    }
  }
  assert.equal(cursor, raw.length, "PNG decoded byte count");
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
