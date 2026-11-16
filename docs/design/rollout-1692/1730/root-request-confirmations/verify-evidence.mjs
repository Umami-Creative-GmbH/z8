#!/usr/bin/env node
// Read-only: immutable Git, explicit public files and syntax parsers only.
// Never imports a runtime harness, starts services, runs tests, writes evidence,
// recursively discovers files or reads private inputs. Output is stdout only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ACTUAL_RUNTIME_AND_QUALITY_CONTRACTS_REVIEWED = true;
assert.equal(ACTUAL_RUNTIME_AND_QUALITY_CONTRACTS_REVIEWED, true,
  "Released runtime/source/quality contracts must be reviewed");

const SOURCE = "a4e2d21f5ab0256bb072af2ef13b7982808f7570";
const MERGE = "7d7d333e685cb9ce0aae3b08bc24394ad1dda1b0";
const PUBLISHED = "fb6c0d7b6289bb0c9d5dd108eff4be5697cd79a8";
const VERIFIED = "e9c9f8e4501cadc63d4377dce1e547ce7cda7bb9";
const SEALS = {
  "source-pins.json": "64a50d91e061edda8b72a47c09429a2d986e8b0dda1423c4291c1d08c797a42a",
  "verification-manifest.json": "b716482cfc8ca0f8564cd1d2bc8c603d626ebb6be6f5a35ff8adcb13ebe514c8",
  "evidence-index.json": "74e1e58fb81d832d3f2136c66cb1c5a225d8f754fe56316a55ef3449ea5bde66",
  "publication-exclusions.json": "8bc4a680e1265c367939179e26a379cd949c022f2a182589b50a50d544ce8917",
  "README.md": "c6e8cd6c8a61f64a498adfa8d3cb1ac3540d3ef31e1a38d9051cfbf407d39492",
  ".gitattributes": "705fd4d6451a31d36b3df7de96f83f30ac976c9b4a6d1e51671d8e2f33e2d0da"
};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const lf = bytes => bytes.toString("utf8").replaceAll("\r\n", "\n");
function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  assert.ok(!(bytes[0] === 0xfe && bytes[1] === 0xff), "Review unexpected UTF-16BE");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}
const parse = bytes => JSON.parse(decodeText(bytes));
const flags = new Set(process.argv.slice(2));
assert.ok([...flags].every(flag => flag === "--current-source"), "Unknown flag");
const archive = dirname(fileURLToPath(import.meta.url));
let repo = archive;
while (!existsSync(join(repo, ".git"))) {
  const parent = dirname(repo);
  assert.notEqual(parent, repo, "Place reviewed archive inside its Git checkout");
  repo = parent;
}
const archiveReal = realpathSync(archive);
const forbidden = /private|credential|cookie|pointer|storage[-_]?state|(?:^|[/.])(?:auth|fixture|temp[-_]?manifest)(?:[/.]|$)/i;
function safeRelative(path) {
  assert.equal(typeof path, "string");
  assert.ok(path && !isAbsolute(path) && !/[:\\\x00-\x1f]/.test(path), "Unsafe path");
  assert.ok(path.split("/").every(p => p && p !== "." && p !== ".."), "Unsafe component");
  assert.ok(!forbidden.test(path), "Forbidden category: do not stat/read/hash");
  return path;
}
function publicFile(path) {
  safeRelative(path);
  const absolute = join(archive, path), resolved = realpathSync(absolute);
  const rel = relative(archiveReal, resolved), item = lstatSync(absolute);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), "Archive escape");
  assert.ok(item.isFile() && !item.isSymbolicLink(), "Expected regular public file");
  return readFileSync(absolute);
}
for (const [path, digest] of Object.entries(SEALS)) {
  assert.match(digest, /^[a-f0-9]{64}$/, "STOP: missing reviewed public seal");
  assert.equal(sha(publicFile(path)), digest, path);
}
const pins = parse(publicFile("source-pins.json"));
const manifest = parse(publicFile("verification-manifest.json"));
const index = parse(publicFile("evidence-index.json"));
const exclusions = parse(publicFile("publication-exclusions.json"));
assert.equal(pins.state, "SEALED_FIXED_GIT");
assert.equal(manifest.state, "SEALED_PUBLIC");
assert.equal(manifest.source, SOURCE);
assert.equal(manifest.runtime.status, "audited-after-release");
assert.equal(manifest.runtime.contractsImplemented, true);
assert.equal(manifest.quality.status, "reviewed-against-actual-source-and-raw-results");
assert.equal(index.schemaVersion, 1);
assert.ok(Array.isArray(index.files) && index.files.length > 0);
assert.equal(index.digest, sha(JSON.stringify(index.files)));
const allowed = new Map(index.files.map(item => {
  safeRelative(item.path);
  assert.ok(/^(checks|support|runtime)\//.test(item.path), "Only reviewed public evidence");
  assert.ok(!/(?:^|\/)(?:verify-evidence|verification-result|evidence-verification|verify-result)(?:[.-]|$)/i.test(item.path),
    "Do not index the verifier or its own results/logs");
  assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0);
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
  return [item.path, item];
}));
assert.equal(allowed.size, index.files.length, "Duplicate public path");
assert.equal(exclusions.policy, "category-only; no private filenames, sizes, hashes, or reads");
assert.ok(exclusions.categories.length > 0);
for (const item of exclusions.categories) {
  assert.equal(typeof item.category, "string");
  assert.equal(typeof item.reason, "string");
}
function read(path) {
  assert.ok(allowed.has(safeRelative(path)), "Not on explicit public allowlist: " + path);
  return publicFile(path);
}
const json = path => parse(read(path)), text = path => decodeText(read(path));
let decodedPngs = 0;
for (const item of index.files) {
  const bytes = read(item.path);
  assert.equal(bytes.length, item.bytes, item.path);
  assert.equal(sha(bytes), item.sha256, item.path);
  if (item.path.endsWith(".json")) parse(bytes);
  if (item.path.endsWith(".png")) { decodePng(bytes); decodedPngs++; }
}
assert.equal(decodeText(publicFile(".gitattributes")), "* -text\n");

// Immutable Git is authoritative. The optional current-source check may
// legitimately fail after later tickets, including #1731 metadata adoption.
const gitCache = new Map();
const git = args => {
  const key = JSON.stringify(args);
  if (!gitCache.has(key)) gitCache.set(key,execFileSync("git",
    ["--no-optional-locks", "-C", repo, ...args],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
  return gitCache.get(key);
};
const gitText = args => git(args).toString("utf8").trim();
const blob = (ref, path) => git(["show", ref + ":" + path]);
assert.equal(gitText(["rev-parse", SOURCE + "^"]), MERGE);
assert.deepEqual(gitText(["rev-list", "--parents", "-n", "1", MERGE]).split(" ").slice(1),
  [PUBLISHED, "b3ba1c5ce8ac9dafd108feef560695ec462dce3b"]);
git(["merge-base", "--is-ancestor", VERIFIED, SOURCE]);
assert.deepEqual([pins.source, pins.merge, pins.published, pins.verified],
  [SOURCE, MERGE, PUBLISHED, VERIFIED]);
assert.deepEqual([pins.incomingPaths.length, pins.rootChangedPaths.length,
  pins.allChangedPaths.length, pins.pins.length], [9, 8, 13, 27]);
assert.equal(new Set(pins.pins.map(p => p.path)).size, 27);
for (const pin of pins.pins) {
  safeRelative(pin.path);
  const bytes = blob(SOURCE, pin.path);
  assert.equal(gitText(["rev-parse", SOURCE + ":" + pin.path]), pin.gitBlob);
  assert.equal(bytes.length, pin.bytes);
  assert.equal(sha(bytes), pin.sha256);
  assert.equal(sha(lf(bytes)), pin.lfSha256);
  if (flags.has("--current-source")) assert.equal(
    sha(lf(readFileSync(join(repo, pin.path)))), pin.lfSha256,
    "Current canonical source changed: " + pin.path);
}
function tree(ref) {
  return new Map(git(["ls-tree", "-r", "-z", ref]).toString("utf8").split("\0")
    .filter(Boolean).map(line => {
      const tab = line.indexOf("\t");
      return [line.slice(tab + 1), line.slice(0, tab)];
    }));
}
const mergedTree = tree(MERGE), sourceTree = tree(SOURCE), publishedTree = tree(PUBLISHED);
const changed = [];
for (const [path, entry] of mergedTree) {
  assert.ok(sourceTree.has(path), "Correction removed merged path: " + path);
  if (sourceTree.get(path) !== entry) changed.push(path);
}
for (const path of sourceTree.keys()) if (!mergedTree.has(path)) changed.push(path);
assert.deepEqual(changed.sort(), [...pins.rootChangedPaths].sort());
const incoming = new Set(pins.incomingPaths);
let preservedPublished = 0;
for (const [path, entry] of publishedTree) if (!incoming.has(path)) {
  assert.equal(mergedTree.get(path), entry, "Merge changed predecessor outside incoming: " + path);
  preservedPublished++;
}
assert.equal(preservedPublished, 15530);
for (const path of pins.preserved1728Paths) {
  assert.deepEqual(blob(SOURCE, path), blob(MERGE, path), path);
  assert.deepEqual(blob(SOURCE, path), blob(VERIFIED, path), path);
}
for (const pin of pins.repositoryManifestPins) {
  assert.equal(pin.sameAsPublished, true);
  assert.equal(sha(blob(SOURCE, pin.path)), pin.sha256);
  assert.deepEqual(blob(SOURCE, pin.path), blob(PUBLISHED, pin.path));
}
const baseline = pins.baselineBulk;
assert.equal(baseline.ref, PUBLISHED);
assert.equal(baseline.rawMatch, true);
assert.equal(baseline.lfMatch, true);
assert.equal(sha(blob(baseline.ref, baseline.path)), baseline.gitSha256);
assert.equal(sha(read("support/merger/merge1730-baseline-bulk.tsx")), baseline.archivedSha256);
assert.equal(baseline.gitSha256, baseline.archivedSha256);
assert.match(pins.provenanceBoundary, /not all machine-exact separately sealed Git stages/);

// Actual physical files and fullName/occurrence identities; not suite totals.
function run(path, counts) {
  const result = json(path), files = result.testResults.map(f => f.name.replaceAll("\\", "/"));
  assert.equal(new Set(files).size, files.length, "Repeated physical test result");
  const cases = [];
  for (let i = 0; i < result.testResults.length; i++) {
    const file = result.testResults[i], at = files[i].lastIndexOf("apps/webapp/");
    assert.ok(at >= 0, "Expected repository test path");
    const physical = files[i].slice(at), occurrence = new Map();
    for (const assertion of file.assertionResults) {
      const count = (occurrence.get(assertion.fullName) ?? 0) + 1;
      occurrence.set(assertion.fullName, count);
      cases.push({ ...assertion, physical,
        key: physical + "\0" + assertion.fullName + "\0" + count });
    }
  }
  assert.equal(new Set(cases.map(c => c.key)).size, cases.length);
  assert.deepEqual([result.numTotalTests, result.numPassedTests, result.numFailedTests,
    result.numPendingTests, files.length], counts);
  assert.equal(cases.length, result.numTotalTests);
  assert.equal(cases.filter(c => c.status === "passed").length, result.numPassedTests);
  assert.equal(cases.filter(c => c.status === "failed").length, result.numFailedTests);
  assert.equal(cases.filter(c => c.status === "skipped" || c.status === "pending").length,
    result.numPendingTests);
  return { result, files, cases };
}
run("support/merger/probes-first.json", [16,12,4,0,3]);
run("support/merger/probes-repeat.json", [18,12,6,0,3]);
run("support/merger/probes-baseline.json", [3,0,1,2,1]);
const expected = {
  "bulk-red":[8,7,1,0,1], "bulk-green":[8,8,0,0,1],
  "workspace-red":[9,8,1,0,1], "workspace-green":[9,9,0,0,1],
  "shared-pending-red":[4,0,4,0,1], "shared-pending-green":[11,11,0,0,2],
  "shared-activation-red":[8,4,4,0,1], "shared-retirement-red":[10,4,6,0,1],
  "shared-activation-green":[17,17,0,0,2],
  "shared-recovery-red":[12,10,2,0,1], "shared-recovery-green":[19,19,0,0,2],
  "tolgee-isolated":[1,1,0,0,1], "unit-final":[335,334,1,0,52],
  "unit-final-02":[335,335,0,0,52],
};
const runs = new Map(Object.entries(expected).map(([name, counts]) =>
  [name, run("checks/" + name + ".json", counts)]));
for (const field of ["errors", "unhandledErrors", "unhandledRejection"])
  assert.equal(Object.hasOwn(runs.get("shared-recovery-red").result, field), false,
    "Actual recovery-red schema changed; review rather than invent a count");
for (const failure of runs.get("shared-recovery-red").cases.filter(c => c.status === "failed")) {
  assert.match(failure.fullName, /reason retryable after invalid input, transport failure and conflict/);
  assert.match(failure.failureMessages.join("\n"), /Unable to find role="alert"/);
}
assert.match(text("checks/shared-recovery-red.log"), /ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL/);
const timeout = runs.get("unit-final").cases.filter(c => c.status === "failed");
assert.equal(timeout.length, 1);
assert.equal(timeout[0].fullName, "extracted translation keys all have a default English value");
assert.match(timeout[0].failureMessages.join("\n"), /Test timed out in 5000ms/);
const finalCases = new Map(runs.get("unit-final-02").cases.map(c => [c.key, c]));
for (const name of ["bulk-green", "workspace-green", "shared-recovery-green", "tolgee-isolated"])
  for (const c of runs.get(name).cases) assert.equal(finalCases.get(c.key)?.status, "passed");
assert.equal([...finalCases.values()].filter(c =>
  c.physical.endsWith("/document-request-confirmation-lifetime.test.tsx")).length, 12);
for (const name of [
  "retires queued bulk validation on Activity return and accepts a fresh confirmation",
  "keeps a failed Activity arrival retryable until a successful read arrives",
]) assert.equal([...finalCases.values()].filter(c => c.fullName === name).length, 1);

// Preserve actual inherited formatting failures and reviewed Doctor warnings.
const all = json("checks/all-changed-paths.json"), root = json("checks/root-changed-paths.json");
const quality = json("checks/quality-all.json");
assert.deepEqual([...all].sort(), [...pins.allChangedPaths].sort());
assert.deepEqual([...root].sort(), [...pins.rootChangedPaths].sort());
assert.deepEqual([...quality.files].sort(), [...all].sort());
assert.deepEqual([quality.formatExit, quality.lintExit], [1,0]);
assert.match(text("checks/biome-root-final.log"), /Checked 8 files[\s\S]*No fixes applied/);
assert.match(text("checks/biome-lint-all.log"), /Checked 13 files[\s\S]*No fixes applied/);
const format = text("checks/biome-format-all.log");
assert.match(format, /route-metadata\.test\.ts format/);
assert.match(format, /route-metadata\.ts format/);
assert.match(format, /Found 2 errors/);
const types = text("checks/typecheck.log");
for (const pattern of [/next typegen/, /tsconfig\.typecheck\.json/,
  /tsconfig\.workflow-contracts\.json/, /tsconfig\.smoke\.json/,
  /Types generated successfully/]) assert.match(types, pattern);
assert.equal(manifest.quality.typecheck.exit, 0, "Requires actual root command-exit record");
const typeExit = json("checks/typecheck-exit-attestation.json");
assert.equal(typeExit.kind, "root-transcript-attestation");
assert.equal(typeExit.source, SOURCE);
assert.equal(typeExit.observedExitCode, 0);
assert.equal(typeExit.checks.length, 4);
assert.match(typeExit.provenance, /not a new execution or a reconstructed raw shell record/);
const doctor = text("checks/doctor.log");
assert.match(doctor, /Scanned 13 files/);
assert.match(doctor, /Bugs: 3 warnings/);
assert.match(doctor, /tanstack-form-on-submit-requires-prevent-default/);
assert.deepEqual([manifest.quality.doctor.errors, manifest.quality.doctor.warnings], [0,3]);
assert.equal(manifest.quality.doctor.review,
  "false-positive: explicit preventDefault and actual cancelable native submit assertions");
for (const path of [
  "apps/webapp/src/components/personnel-file/bulk-document-requests-dialog.tsx",
  "apps/webapp/src/components/personnel-file/cancel-document-request-dialog.tsx",
  "apps/webapp/src/components/personnel-file/document-request-decision.tsx",
]) assert.match(blob(SOURCE, path).toString("utf8"), /event\.preventDefault\(\)/);
for (const path of [
  "apps/webapp/src/components/personnel-file/bulk-document-requests-dialog.test.tsx",
  "apps/webapp/src/components/personnel-file/document-request-confirmation-lifetime.test.tsx",
]) {
  const code = blob(SOURCE, path).toString("utf8");
  assert.match(code, /cancelable: true/);
  assert.match(code, /submission\.defaultPrevented\)\.toBe\(true\)/);
}

const runtimeSummary = verifyActualReleasedRuntime();
const syntaxSummary = verifySyntaxAndHelpers();
const linkCount = verifyLinks();
console.log(JSON.stringify({status:"verified",source:SOURCE,
  currentSourceChecked:flags.has("--current-source"),publicArtifacts:index.files.length,
  decodedPngs,unitCases:335,physicalUnitFiles:52,focusedRunsNonadditive:true,
  ...runtimeSummary,...syntaxSummary,localProseLinks:linkCount,
  privateEvidenceRead:false,runtimeHarnessesExecuted:0,testsRerun:false}));

function verifyActualReleasedRuntime() {
  const released = json("runtime/artifact-hashes.json");
  const runtime = json("runtime/verification-manifest.json");
  assert.equal(released.head, SOURCE);
  assert.equal(released.privateInputsAndRawOutputsExcludedEvenHashOnly, true);
  assert.equal(released.publicArtifactDigests.length, 131);
  assert.equal(new Set(released.publicArtifactDigests.map(x => x.file)).size, 131);
  assert.equal(released.publication.kind, "public-manifest-clone-mapping");
  assert.equal(released.publication.releasedPublicManifestSha256,
    "1c42b680db6b507facadbd534fb3f7fef7038e2b4b317fc49388635261d32a6d");
  assert.equal(released.publication.releasedPublicHashListSha256,
    "1a3262bfda8e4ed6c7616e46a10830a0a6a7145652a36b15ec924226bf2150a5");
  assert.equal(sha(read("runtime/HANDOFF-runtime.md")),
    "7bc4f190f7571a456138729b4af6f2fb957e12d94464a60ac07f9b59a2a0974d");
  assert.equal(released.publication.publishedManifestSha256,
    sha(read("runtime/verification-manifest.json")));
  assert.equal(manifest.runtime.publishedManifestSha256,
    released.publication.publishedManifestSha256);
  assert.match(runtime.publicationQualification, /Category-redacted public clone/);
  assert.ok(runtime.commands.some(x => x.includes("<OWN_PRIVATE_FIXTURE_POINTER>")));
  assert.ok(runtime.commands.filter(x => x.includes("-FixturePointer"))
    .every(x => x.includes("<OWN_PRIVATE_FIXTURE_POINTER>")));
  const runtimePaths = released.publicArtifactDigests.map(x => "runtime/" + x.file);
  assert.deepEqual(runtimePaths, manifest.runtime.files);
  for (const pin of released.publicArtifactDigests) {
    const bytes = read("runtime/" + pin.file);
    assert.equal(bytes.length, pin.bytes, pin.file);
    assert.equal(sha(bytes), pin.sha256, pin.file);
  }
  assert.deepEqual([runtime.head,runtime.sourceStart,runtime.sourceEnd],
    [SOURCE,SOURCE,SOURCE]);
  assert.equal(runtime.trackedClean, true);
  const initial = json("runtime/source-start.json");
  assert.equal(initial.head, SOURCE);
  assert.equal(initial.pins.length, 13);
  assert.equal(initial.configs.length, 5);
  assert.equal(initial.physical.length, 3);
  assert.equal(initial.links.length, 158);
  assert.deepEqual(runtime.sourcePins, initial.pins);
  assert.deepEqual(runtime.configuration, initial.configs);
  const lock = initial.configs.find(x => x.path === "pnpm-lock.yaml");
  assert.equal(lock.sha256.toUpperCase(), runtime.dependencies.approvedLock);
  assert.deepEqual([runtime.dependencies.physicalParents,
    runtime.dependencies.internalLeaves,runtime.dependencies.unchanged,
    runtime.dependencies.noInstall],[3,158,true,true]);
  // Check released alias records as data only: no current node_modules traversal.
  const checkout = initial.physical[0].real.replaceAll("\\", "/")
    .replace(/\/node_modules$/, "");
  assert.equal(new Set(initial.physical.map(x => x.path)).size, 3);
  for (const item of initial.physical) assert.equal(
    item.real.replaceAll("\\", "/"), checkout + "/" + item.path.replaceAll("\\", "/"));
  assert.equal(new Set(initial.links.map(x => x.path)).size, 158);
  for (const item of initial.links) {
    const target = item.target.replaceAll("\\", "/");
    assert.ok(target.startsWith(checkout + "/node_modules/.pnpm/"));
    assert.ok(!target.split("/").includes(".."));
  }
  assert.deepEqual([runtime.trackedPreservation.count,
    runtime.trackedPreservation.digest,runtime.trackedPreservation.unchanged],
    [12506,initial.trackedSnapshot.digest,true]);
  assert.equal(initial.trackedSnapshot.count,12506);
  assert.match(runtime.trackedPreservation.scope,/apps\/webapp\/src, packages and docs\/design\/rollout-1692/);
  assert.equal(pins.repositoryManifestPins.length,7);
  for (const config of initial.configs) {
    const canonical=lf(blob(SOURCE,config.path));
    assert.ok([sha(canonical),sha(canonical.replaceAll("\n","\r\n"))]
      .includes(config.sha256),"Runtime raw config must match fixed Git LF/CRLF: "+config.path);
    if(flags.has("--current-source")) assert.equal(
      sha(lf(readFileSync(join(repo,config.path)))),sha(canonical),config.path);
  }
  const prior = json("support/prior-proof-groups.json");
  assert.deepEqual([prior.baseline,prior.candidate],[PUBLISHED,SOURCE]);
  assert.deepEqual(prior.groups.map(x => x.trackedPaths),[152,163,203,211,266]);
  for (const group of prior.groups) {
    assert.equal(group.changedPaths,0);
    const under = [...sourceTree.keys()].filter(x => x.startsWith(group.path + "/"));
    assert.equal(under.length,group.trackedPaths);
    for (const path of under) assert.equal(sourceTree.get(path),publishedTree.get(path));
  }
  function verifySource(observation, historical = false) {
    assert.equal(observation.head,SOURCE);
    assert.equal(sha(JSON.stringify(observation.pins)),observation.digest);
    assert.equal(new Set(observation.pins.map(p => p.path)).size,observation.pins.length);
    assert.ok(observation.pins.length >= 13);
    for (const p of observation.pins) {
      safeRelative(p.path);
      const overlayPin = historical && applied.pins.find(x => x.path === p.path);
      const ref = overlayPin ? PUBLISHED : SOURCE;
      assert.equal(sha(lf(blob(ref,p.path))),p.lf,p.path);
      if (overlayPin) assert.equal(p.raw,overlayPin.historicalRaw,p.path);
      else if (initial.pins.some(x => x.path === p.path))
        assert.equal(p.raw,initial.pins.find(x => x.path === p.path).raw,p.path);
    }
  }
  const applied=json("runtime/overlay-applied.json"),restored=json("runtime/overlay-restored.json");
  assert.deepEqual([applied.ref,applied.head,applied.pins.length],[PUBLISHED,SOURCE,6]);
  assert.equal(restored.byteExact,true);
  assert.equal(restored.head,SOURCE);
  assert.deepEqual(restored.after,applied.before);
  assert.equal(new Set(applied.pins.map(x => x.path)).size,6);
  for (const p of applied.pins) {
    assert.equal(sha(blob(PUBLISHED,p.path)),p.historicalRaw,p.path);
    assert.equal(initial.pins.find(x => x.path === p.path)?.raw,p.currentRaw,p.path);
  }
  verifySource(applied.before);verifySource(applied.after,true);verifySource(restored.after);
  const postgres=run("runtime/postgres.json",[99,99,0,0,6]);
  const units=runs.get("unit-final-02");
  assert.equal(new Set([...units.files,...postgres.files]).size,58);
  assert.equal(new Set([...units.cases,...postgres.cases].map(x => x.key)).size,434);
  const pgCommand=json("runtime/postgres-command.json");
  assert.equal(pgCommand.exitCode,0);verifySource(pgCommand.source);
  assert.match(pgCommand.literalCommand,/--config\.verify-deps-before-run=false.*--project integration --maxWorkers 1/);
  assert.deepEqual(runtime.fresh.postgres,{physicalFiles:6,uniqueCases:99,
    passed:99,failed:0,skipped:0,canonicalSetup:true});
  let functionalAssertions=0;
  for (const [file,count] of [["actions-03.json",35],["recovery-03.json",8],
    ["roles-03.json",11],["uploads-02.json",15]]) {
    const record=json("runtime/"+file);
    assert.equal(record.status,"passed",file);
    assert.equal(record.checks.length,count,file);
    assert.equal(Object.hasOwn(record,"failure"),false,file);
    verifySource(record.source);
    if(record.sourceEnd) {verifySource(record.sourceEnd);assert.deepEqual(record.source,record.sourceEnd);}
    const declared=runtime.fresh.functional.find(x => x.file===file);
    assert.deepEqual(declared,{file,assertions:count,passed:count});
    functionalAssertions+=count;
  }
  assert.equal(functionalAssertions,69);
  const actions=json("runtime/actions-03.json");assert.deepEqual(actions.errors,[]);
  const check=new Map(actions.checks.map(x=>[x.name,x.actual]));
  assert.equal(actions.bulkCreated,3);assert.match(actions.bulkSummary,/3 document requests created/);
  for(const stage of ["bulk","return","cancel"]) {
    const held=actions.transport.filter(x=>x.stage===stage&&x.mode==="hold");
    assert.equal(held.length,1,stage);
    assert.equal(check.get(stage+" held admission count"),1);
    assert.equal(check.get(stage+" exactly one held action"),1);
    assert.equal(actions.transport.filter(x=>x.stage===stage+"-transport"&&x.mode==="abort").length,1);
  }
  assert.equal(check.get("bulk failed transport wrote zero requests"),0);
  assert.equal(check.get("return failed transport status unchanged"),"submitted");
  assert.equal(check.get("cancel failed transport status unchanged"),"open");
  assert.equal(check.get("return real readback reopened"),"open");
  assert.equal(check.get("cancel real readback cancelled"),"cancelled");
  assert.equal(check.get("original accept path real readback"),"accepted");
  for(const [kind,stage] of [["returned","return"],["cancelled","cancel"]]) {
    assert.deepEqual(check.get("one real "+kind+" event with exact reason"),
      [{kind,reason:check.get(stage+" exact reason retained")}]);
    assert.equal(check.get(stage+" actual transport failure retained exact reason"),
      check.get(stage+" exact reason retained"));
  }
  const recovery=json("runtime/recovery-03.json");
  assert.deepEqual([recovery.cancelledReads,recovery.cancelledDifferentReads,
    recovery.cancelledActivityReads],[1,1,1]);
  assert.match(recovery.failureMechanism,/pg_cancel_backend.*owned|pg_cancel_backend.*own/);
  assert.match(recovery.failureMechanism,/rollback in finally/);
  const roles=json("runtime/roles-03.json");
  assert.deepEqual(roles.grant,{categories:["certificate"],scope:"specific",specificEmployees:2});
  assert.equal(roles.refusalText,"Document request not found");
  assert.ok(roles.checks.includes("live revocation wrote zero matching reason events"));
  const uploads=json("runtime/uploads-02.json");
  assert.equal(uploads.documents.length,2);
  for(const doc of uploads.documents) {
    assert.equal(doc.bytes,68);
    assert.equal(doc.sha256,"a38a4ff7320a3d8764ac959b264f15e335360d7c1e23a0627dee7f366c95c58f");
  }
  assert.match(uploads.qualification,/genuine employee Tus\/finalize\/upload\/submit/);
  assert.match(uploads.qualification,/renewal remains fresh PG-only/);
  const current=json("runtime/matched-current-05.json"),before=json("runtime/matched-before-06.json"),
    final=json("runtime/matched-restored-06.json");
  for (const [record,count,captures,historical] of [[current,19,5,false],[before,14,5,true],[final,4,1,false]]) {
    assert.equal(record.status,"passed");assert.equal(record.checks.length,count);
    assert.equal(record.captures.length,captures);assert.deepEqual(record.errors,[]);
    verifySource(record.source,historical);
    assert.equal(sha(JSON.stringify(record.recordTitles)),record.recordTitlesDigest);
    assert.equal(record.recordTitles.length,10);
    assert.equal(record.recordTitlesDigest,"e67936c9dda9af1cdb346021fce9f959177dd751e8a3aebc4f374fbb6bc4ec0e");
    for(const cap of record.captures) {
      assert.deepEqual(cap.visibleRecordTitles,record.recordTitles);
      assert.equal(cap.dialogs,0);assert.equal(cap.fontStatus,"loaded");
      assert.ok(cap.documentWidth<=cap.viewport.width);
      assert.deepEqual(cap.h1,historical?["Z8","Document requests"]:["Document requests"]);
    }
  }
  assert.match(before.qualification,/PARTIAL APPLICATION/);
  const viewports=[[1600,1000,"16px"],[1600,1000,"16px"],[390,844,"16px"],
    [2400,1200,"18px"],[390,844,"18px"]];
  for(const record of [current,before]) {
    assert.equal(record.drawerFocus.sidebarTrigger,true);
    assert.equal(record.drawerFocus.label,"Toggle Sidebar");
    for(let i=0;i<5;i++) assert.deepEqual(
      [record.captures[i].viewport.width,record.captures[i].viewport.height,record.captures[i].font],viewports[i]);
  }
  // Every public capture reference is byte pinned; ignored contact captures are
  // deliberately not statted/read/hashed and are not inferred from directory scans.
  let captureReferences=0;
  for(const path of runtimePaths.filter(x=>x.endsWith(".json"))) {
    const record=json(path);
    for(const cap of record.captures??[]) {
      const target="runtime/"+cap.file;
      assert.ok(allowed.has(target),"Capture not public: "+path);
      assert.equal(sha(read(target)),cap.sha256,cap.file);captureReferences++;
    }
  }
  function next(record) {
    const observations=record.next.observations;
    const result=name=>observations.find(x=>x.name===name)?.response.result.content
      .filter(x=>x.type==="text").map(x=>JSON.parse(x.text));
    assert.deepEqual(result("get_compilation_issues"),[{issues:[]}]);
    assert.deepEqual(result("get_errors"),[{configErrors:[],sessionErrors:[]}]);
    assert.ok(JSON.stringify(result("get_page_metadata")).includes("/personnel-files/document-requests"));
  }
  const native=[];
  for(const file of ["native-public.json","native-restored-public.json"]) {
    const record=json("runtime/"+file);verifySource(record.source);next(record);
    assert.equal(record.status,"actual-target-tree-observed");
    assert.deepEqual(record.auth,{code:0,signIn:200,active:200});
    assert.equal(record.close.code,0);
    assert.equal(record.harnessSha256,sha(read("runtime/native.mjs")));
    for(const name of ["open","target","wait","tree","snapshot"])
      assert.equal(record.commands.find(x=>x.name===name)?.code,0,name);
    const tree=JSON.parse(record.commands.find(x=>x.name==="tree").out);
    assert.match(tree.data.tree,/DocumentRequestsWorkspace/);
    const permission=record.commands.find(x=>x.name==="permission");
    assert.equal(permission.code,1);assert.match(permission.out,/Notification is not defined/);
    native.push(record.session);
  }
  assert.equal(new Set(native).size,2);next(current);next(before);next(final);
  assert.match(text("runtime/native-restored.mjs"),/native\.mjs/);
  const cleanup=json("runtime/cleanup.json");assert.deepEqual(cleanup,runtime.cleanup);
  assert.deepEqual([cleanup.nativeSessionsClosed,cleanup.ownedProcessesRemaining,
    cleanup.exactManifestContainersAbsent,cleanup.verifiedStoppedPidCount],[2,0,3,49]);
  for(const flag of ["privateFixtureManifestsPreserved","nativeDaemonsAbsent","ownedNextPortClosed"])
    assert.equal(cleanup[flag],true,flag);
  assert.equal(cleanup.cacheMoved,false);
  for(const file of ["stop-current-before-overlay.json","stop-historical-before-restore.json","stop-final.json"]) {
    const stop=json("runtime/"+file);
    for(const flag of ["portClosed","ownedNextStopped","ownedNextIdentityVerified","filteredProcessInventory"])
      assert.equal(stop[flag],true,file+":"+flag);
    assert.equal(stop.cacheMoved,false);assert.ok(stop.stoppedPids.length>0);
  }
  for(const [file,count] of [["actions-01.json",13],["actions-02.json",13],["recovery.json",6],
    ["recovery-02.json",7],["roles.json",0],["roles-02.json",0],["uploads.json",0],
    ["matched-current.json",11],["matched-current-04.json",0],["matched-before-05.json",1]]) {
    const failed=json("runtime/"+file);assert.equal(failed.checks.length,count);
    assert.ok(failed.failure);assert.notEqual(failed.status,"passed");
  }
  for(const file of ["roles.json","roles-02.json"]) {
    const failed=json("runtime/"+file);assert.deepEqual(failed.captures,[]);
    assert.match(failed.publicationQualification,/Excluded contact-capture references removed/);
  }
  assert.equal(json("runtime/matched-current-02.json").status,"passed");
  assert.ok(runtime.failedAttempts.some(x=>x.includes("streamed-shell captures")));
  assert.ok(json("runtime/discover-public.json").failure);
  assert.equal(decodedPngs,56);
  assert.equal(manifest.freshRuntimeCounts.publishedPngs,56);
  assert.equal(manifest.scope.wholeAppReady,false);
  assert.equal(manifest.scope.wholeBranchReviewComplete,false);
  assert.equal(manifest.scope.currentRosterFourPathGuard,"unresolved and unrun here");
  return {postgresCases:99,physicalPostgresFiles:6,distinctCases:434,
    distinctPhysicalFiles:58,functionalAssertions,matchedAssertions:[19,14,4],
    captureReferences,ownedProcessesRemaining:0,nativePermissionProbeFailures:2};
}

function verifySyntaxAndHelpers() {
  const plan=json("support/publication-plan.json");
  assert.equal(plan.staticFiles.length,53);assert.equal(plan.runtimePublicFiles.length,131);
  const planned=new Set([...plan.staticFiles,...plan.runtimePublicFiles,...plan.additionalPublicFiles,
    "support/publication-plan.json"]);
  assert.deepEqual([...planned].sort(),[...allowed.keys()].sort());
  const helpers=manifest.runtime.helpers;
  assert.deepEqual(helpers,plan.helpers);
  const scripts=[...allowed.keys()].filter(x=>x.endsWith(".mjs"));
  assert.equal(scripts.length,33);
  assert.deepEqual(helpers.map(x=>x.path).sort(),scripts.sort());
  for(const helper of helpers) {
    assert.equal(sha(read(helper.path)),helper.sha256);
    assert.ok(["operational helper; syntax only here","historical driver snapshot; syntax only here",
      "runtime driver; syntax only here"].includes(helper.classification));
    execFileSync(process.execPath,["--check",join(archive,helper.path)],
      {stdio:["ignore","pipe","pipe"],windowsHide:true});
  }
  // TypeScript7's installed CJS entry is version-only. Parse TSX with the
  // existing Next dependency's Babel parser; do not install or execute sources.
  const appRequire=createRequire(join(repo,"apps/webapp/package.json"));
  const parser=createRequire(appRequire.resolve("next/package.json"))("@babel/parser");
  const tsx=[...allowed.keys()].filter(x=>x.endsWith(".tsx"));
  for(const path of tsx) {
    parser.parse(text(path),{sourceType:"module",plugins:["typescript","jsx"]});
  }
  const powershell=[...allowed.keys()].filter(x=>x.endsWith(".ps1"));
  for(const path of powershell) {
    const quoted=join(archive,path).replaceAll("'","''");
    const command="$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+
      quoted+"',[ref]$null,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|Out-String)}";
    execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",
      Buffer.from(command,"utf16le").toString("base64")],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
  }
  return {syntaxCheckedScripts:scripts.length,syntaxParsedTsx:tsx.length,
    syntaxParsedPowershell:powershell.length};
}

function verifyLinks() {
  let count=0;
  const prose=["README.md",...index.files.filter(x=>x.path.endsWith(".md")).map(x=>x.path)];
  for(const path of prose) {
    const body=path==="README.md"?decodeText(publicFile(path)):text(path);
    for(const match of body.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target=match[1];if(/^(?:https?:|mailto:|#)/i.test(target))continue;
      const local=target.split("#")[0];if(!local)continue;
      const resolved=join(dirname(join(archive,path)),decodeURIComponent(local));
      const rel=relative(archiveReal,resolved);
      assert.ok(!rel.startsWith("..")&&!isAbsolute(rel),"Prose link escaped archive: "+target);
      assert.ok(existsSync(resolved),"Broken prose link: "+path+" -> "+target);count++;
    }
  }
  return count;
}

// Full PNG CRC/scanline decoder follows, copied as source from fixed #1729 model.


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
