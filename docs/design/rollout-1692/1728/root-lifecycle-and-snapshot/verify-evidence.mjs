#!/usr/bin/env node
// Read-only archive verifier. Never imports the archived runtime drivers.
// Usage: node verify-evidence.mjs [--current-source] [--local-dependencies]
// Default: Git blobs at the recorded source commit + archived evidence + full PNG decode.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const archive = dirname(fileURLToPath(import.meta.url));
let repo = archive;
while (!existsSync(join(repo, ".git"))) {
	const parent = dirname(repo);
	assert.notEqual(parent, repo, "Run within the Z8 checkout");
	repo = parent;
}
const flags = new Set(process.argv.slice(2));
assert.ok([...flags].every((f) => ["--current-source", "--local-dependencies"].includes(f)), "Unknown verifier flag");
const SOURCE = "abe51cc17fb89f20af185ea0ce12431e4e450cdb";
const PROVISIONAL = "80ca442bd36692f0b9a87c4f94d106a3d81492de";
const VERIFIED = "16443982de929de4f885a6cfb6de5b377374cb3e";
const HISTORICAL = "a5c7f741c0df6816e0e2b10290d79b7409fc606f";
const DIGEST = "f91a1bdcced8a4689ec8fd1733da012cc2d8049390be6a3c1380f2410797d8a2";
const MANIFEST_SHA = "ab37639e27659f67a50900bb43b33324faac2202a35acb43f885ac5f3d206edf";
const INDEX_SHA = "4f3e0fe9b1f60829749daedfb4349d4bf31cc978fed19fc4d7d741c7809e9ed5";
const INDEX_DIGEST = "b9826358544646646068c3ef972ad38c670ea17adfcad9cd0c6d5203056f270f";
const CONTROL_HASHES = {
	"roster-guard-baseline.json": "30865ad43190ad0659777e236fc1e46ef5e60244018776b33f0d4fb5b6d250be",
	"arrival-red.json": "f5640f75911fb4d79f17ba3f985423b2163382ed43327a81711875271658f3a0",
	"arrival-green.json": "7840f4779a807fc9d04e3c60aa66e0d2d34c11e73e8eeb7794986155bc7270f7",
	"pg-red.json": "253e27b222d46b60bfc12df8946fe7b7999cc17a01b142c3db6c049c13bf4ad2",
	"pg-green.json": "c9da82fcc855c537e45eb535bed5f499b8d84985aaf1b80da5c4351021653bf1",
};
const DEPENDENCY_PROOF_SHA = "3ef065942682f6e147e0e3dbcb82f049fa342d6e2f31c15fff612e2e9f8c20f9";
const PRIVATE = { path: "pg-all-private.log", bytes: 2968, sha256: "af809973f2d2b8808c8e1fea790da2e4a5972e254112c929bd6aa23fc5a8fb00" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lf = (bytes) => bytes.toString("utf8").replaceAll("\r\n", "\n");
const read = (path) => readFileSync(join(archive, path));
const json = (path) => JSON.parse(read(path).toString("utf8").replace(/^\uFEFF/, ""));
const text = (path) => read(path).toString("utf8");
const gitBlob = (ref, path) => execFileSync("git", ["--no-optional-locks", "-C", repo, "show", `${ref}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
function safeRelative(path) {
	assert.equal(typeof path, "string");
	assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).includes(".."), `Unsafe archive path ${path}`);
	assert.ok(!/private|pointer/i.test(path), `Private/pointer path must never be opened: ${path}`);
	return path;
}
function verifySnapshot(snapshot, expected = DIGEST) {
	assert.equal(snapshot.head, SOURCE);
	assert.equal(snapshot.pins.length, 19);
	assert.equal(sha(JSON.stringify(snapshot.pins)), expected);
	assert.equal(snapshot.digest, expected);
}
function parseNative(result) {
	return JSON.parse(result.out.trim());
}
function nextClean(next) {
	const observations = next.observations;
	const metadata = observations.find((observation) => observation.name === "get_page_metadata");
	assert.ok(metadata, "Missing exact-route metadata observation");
	const page = JSON.parse(metadata.response.result.content.find((item) => item.type === "text").text);
	assert.ok(page.sessions.length > 0);
	assert.ok(page.sessions.every((session) => session.url === "/en/personnel-files"));
	for (const name of ["get_compilation_issues", "get_errors"]) {
		const found = observations.find((observation) => observation.name === name);
		assert.ok(found, `Missing recorded Next observation ${name}`);
		const value = JSON.parse(found.response.result.content.find((item) => item.type === "text").text);
		assert.deepEqual(value, name === "get_errors" ? { configErrors: [], sessionErrors: [] } : { issues: [] });
	}
}

// Hash pins seal integrity; they are not a claim of a cryptographic signing authority.
assert.equal(sha(read("acceptance/verification-manifest.json")), MANIFEST_SHA);
assert.equal(sha(read("acceptance/artifact-hashes.json")), INDEX_SHA);
const manifest = json("acceptance/verification-manifest.json");
const index = json("acceptance/artifact-hashes.json");
assert.equal(manifest.head, SOURCE);
assert.equal(manifest.workingTreeClean, true, "Recorded checkpoint was clean");
assert.equal(manifest.sourcePins.length, 19);
assert.equal(sha(JSON.stringify(manifest.sourcePins)), DIGEST);
assert.equal(manifest.sourceDigest, DIGEST);
assert.equal(index.files.length, 109);
assert.equal(index.digest, INDEX_DIGEST);
assert.equal(sha(JSON.stringify(index.files)), INDEX_DIGEST);
assert.equal(new Set(index.files.map((item) => item.path)).size, 109);
const exclusionsDocument = json("publication-exclusions.json");
const exclusions = Array.isArray(exclusionsDocument) ? exclusionsDocument : exclusionsDocument.excluded ?? exclusionsDocument.exclusions ?? exclusionsDocument.files;
assert.equal(exclusionsDocument.indexedArtifacts, 109);
assert.equal(exclusionsDocument.publicIndexedArtifacts, 108);
assert.ok(Array.isArray(exclusions), "Publication exclusions must be explicit");
assert.equal(exclusions.length, 1);
const excluded = exclusions[0];
assert.deepEqual({ path: excluded.path, bytes: excluded.bytes, sha256: excluded.sha256 }, PRIVATE);
assert.ok(typeof excluded.reason === "string" && excluded.reason.trim(), "Record why the private log is omitted");
assert.equal(existsSync(join(archive, "acceptance", PRIVATE.path)), false, "Private log must not be published");
for (const item of index.files) {
	if (item.path === PRIVATE.path) {
		assert.deepEqual(item, PRIVATE);
		continue; // Do not stat, read, hash, or import private artifacts.
	}
	safeRelative(item.path);
	const bytes = read(`acceptance/${item.path}`);
	assert.equal(bytes.length, item.bytes, item.path);
	assert.equal(sha(bytes), item.sha256, item.path);
}
assert.equal(index.files.filter((item) => item.path.endsWith(".png")).length, 33);

// Source validation reads immutable Git blobs, without checkout or index changes.
for (const pin of manifest.sourcePins) {
	assert.equal(sha(lf(gitBlob(SOURCE, pin.path))), pin.lf, `${SOURCE}:${pin.path}`);
	if (flags.has("--current-source")) {
		const bytes = readFileSync(join(repo, pin.path));
		assert.equal(sha(bytes), pin.raw, `Current raw bytes: ${pin.path}`);
		assert.equal(sha(lf(bytes)), pin.lf, `Current LF bytes: ${pin.path}`);
	}
}
for (const [file, digest] of Object.entries(CONTROL_HASHES)) assert.equal(sha(read(`controls/${file}`)), digest, file);
assert.equal(sha(read("dependency-proof.json")), DEPENDENCY_PROOF_SHA);
const baseline = json("controls/roster-guard-baseline.json");
assert.equal(baseline.base, PROVISIONAL);
assert.equal(baseline.verified, VERIFIED);
assert.equal(baseline.grown.length, 4);
assert.equal(manifest.broadGuardBaseline.length, 4);
for (const recorded of manifest.broadGuardBaseline) {
	assert.equal(recorded.byteIdenticalAtProvisionalAndVerified, true);
	const current = gitBlob(SOURCE, recorded.path);
	assert.equal(sha(current), recorded.gitBlobSha256);
	assert.deepEqual(gitBlob(PROVISIONAL, recorded.path), current);
	assert.deepEqual(gitBlob(VERIFIED, recorded.path), current);
	const classification = baseline.grown.find((item) => `apps/webapp/src/${item.file}` === recorded.path);
	assert.ok(classification);
	assert.deepEqual([classification.current, classification.atProvisional, classification.atVerified], [1, 1, 1]);
	assert.equal(classification.baseline, 0);
	assert.equal(classification.entireSourceMatchesProvisional, true);
}

function cases(result) {
	return result.testResults.flatMap((file) => file.assertionResults.map((item) => ({ file: file.name.replaceAll("\\", "/"), name: item.fullName, status: item.status })));
}
const unit = json("acceptance/unit.json");
const pg = json("acceptance/pg-all.json");
const unitCases = cases(unit), pgCases = cases(pg), finalCases = [...unitCases, ...pgCases];
assert.deepEqual([unit.testResults.length, unitCases.length, pg.testResults.length, pgCases.length], [26, 328, 11, 149]);
assert.equal(new Set(finalCases.map((item) => `${item.file}\0${item.name}`)).size, 477);
assert.equal(new Set(finalCases.map((item) => item.file)).size, 37);
assert.equal(finalCases.filter((item) => item.status === "passed").length, 476);
const failures = finalCases.filter((item) => item.status !== "passed");
assert.equal(failures.length, 1);
assert.equal(failures[0].status, "failed");
assert.ok(failures[0].file.endsWith("/src/lib/employee-lifecycle/current-roster-surfaces.test.ts"));
assert.equal(failures[0].name, "current-roster surface guard adds no hand-written employee active checks beyond the baseline");
assert.equal(pg.success, true);
for (const [name, exit, pins] of [["unit", 1, 12], ["pg-all", 0, 3], ["types", 0, 12], ["lint", 0, 12], ["format", 1, 12], ["doctor", 0, 12]]) {
	const command = json(`acceptance/${name}-command.json`);
	assert.equal(command.sourceHead, SOURCE);
	assert.equal(command.exitCode, exit);
	assert.equal(Object.keys(command.sourcePins).length, pins);
	for (const [path, digest] of Object.entries(command.sourcePins)) assert.equal(manifest.sourcePins.find((pin) => pin.path === path)?.lf, digest);
}
assert.match(text("acceptance/lint.log"), /Checked 12 files/);
assert.match(text("acceptance/format.log"), /Found 5 errors/);
assert.equal(manifest.fresh.formattingPaths.length, 5);
for (const config of ["tsconfig.typecheck.json", "tsconfig.workflow-contracts.json", "tsconfig.smoke.json"]) assert.ok(text("acceptance/types.log").includes(config));
const doctor = json("acceptance/doctor.json"); // Structured --json-out; never parse original-worker stdout as JSON.
assert.equal(doctor.ok, true);
assert.equal(doctor.diff.changedFileCount, 12);
assert.equal(doctor.baseline.baseRef, VERIFIED);
assert.deepEqual([doctor.summary.errorCount, doctor.summary.warningCount, doctor.summary.totalDiagnosticCount], [0, 0, 0]);
for (const [file, total, passed, failed] of [["arrival-red.json", 5, 1, 4], ["arrival-green.json", 9, 9, 0], ["pg-red.json", 2, 1, 1], ["pg-green.json", 2, 2, 0]]) {
	const recorded = cases(json(`controls/${file}`));
	assert.deepEqual([recorded.length, recorded.filter((item) => item.status === "passed").length, recorded.filter((item) => item.status === "failed").length], [total, passed, failed]);
}

// Archived code is hashed only, never imported or executed.
const runtime = json("acceptance/runtime-08.json");
verifySnapshot(runtime.source); verifySnapshot(runtime.sourceEnd);
assert.equal(runtime.stage, "completed"); assert.equal(runtime.failure, undefined); assert.deepEqual(runtime.errors, []);
assert.equal(sha(read("acceptance/runtime.mjs")), runtime.harness["runtime.mjs"]);
assert.equal(sha(read("acceptance/common-v1-source.mjs")), runtime.harness["common.mjs"]);
assert.equal(runtime.grant.scope, "specific"); assert.deepEqual(runtime.grant.categories, ["certificate"]); assert.equal(runtime.grant.is_active, true);
assert.deepEqual(runtime.grant.employees, [{ employee_id: runtime.requestIdentity.employeeId }]); assert.deepEqual(runtime.grant.teams, []);
assert.deepEqual(runtime.revoked, [{ id: runtime.grant.id, is_active: false }]);
assert.deepEqual(runtime.afterDraft, runtime.beforeDraft);
assert.equal(runtime.beforeDraft.deadline, "Nov 20, 2026"); assert.equal(runtime.deadlineDay, "2026-11-20");
assert.equal(runtime.beforeDraft.category, "Certificate"); assert.equal(runtime.beforeDraft.categoryDisabled, true);
assert.equal(runtime.beforeDraft.title, runtime.requestIdentity.title);
assert.ok(runtime.beforeDraft.note && runtime.beforeDraft.renewal && runtime.requestIdentity.organizationId);
assert.deepEqual([runtime.initialRequestRows, runtime.finalRequestRows], [0, 0]);
assert.ok(runtime.refusalToast.includes("Document request not found"));
assert.ok(runtime.lateTransport.some((item) => item.kind === "request") && runtime.lateTransport.some((item) => item.kind === "response"));
assert.equal(runtime.officerLinks.filter((href) => href.includes("?category=")).length, 1);
assert.ok(runtime.officerLinks.includes(`/en/personnel-files/${runtime.requestIdentity.employeeId}?category=certificate`));
nextClean(runtime.next);
const runtimeCode = text("acceptance/runtime.mjs");
assert.match(runtimeCode, /select count\(\*\)::int as n from employee_document_request where organization_id=\$1 and employee_id=\$2 and title=\$3/);
assert.match(runtimeCode, /select id,is_active from personnel_file_officer_grant where organization_id=\$1 and officer_employee_id=\$2 and id=\$3/);
assert.ok(runtimeCode.includes("await click(p,'Revoke access')") && runtimeCode.includes("await submit.click()"));
const expiry = json("acceptance/runtime-01.json");
verifySnapshot(expiry.source);
assert.equal(expiry.stage, "grant"); assert.ok(expiry.failure, "Early attempt must remain failed overall");
assert.equal(sha(read("acceptance/runtime-01-source.mjs")), expiry.harness["runtime.mjs"]);
assert.equal(sha(read("acceptance/common-v1-source.mjs")), expiry.harness["common.mjs"]);
assert.ok(expiry.lock.held.some((item) => item.blockers.includes(expiry.lock.lockPid) && item.query.includes('"employee_document"')));
for (const phrase of ["Real scoped expiry query cancellation", "Independent directory retains", "Actual pointer Retry restores"]) assert.ok(expiry.checks.some((item) => item.startsWith(phrase)));
const oldDeadline = json("acceptance/runtime-07.json");
assert.equal(oldDeadline.beforeDraft.deadline, "");
assert.ok(oldDeadline.errors.some((error) => String(error).includes("Hydration failed") && String(error).includes('name="country"')));

const overlay = json("acceptance/overlay-applied.json");
const restored = json("acceptance/overlay-restored.json");
assert.equal(overlay.ref, HISTORICAL); assert.equal(overlay.pins.length, 3); assert.equal(restored.byteExact, true); verifySnapshot(restored.source);
const before = json("acceptance/matched-before.json"), current = json("acceptance/matched-current.json");
verifySnapshot(before.source, "10261be6c2f9fe03d04bb55c433670a9b912a5f4950a19d0953158bbd0887e54");
verifySnapshot(before.sourceEnd, before.source.digest); verifySnapshot(current.source); verifySnapshot(current.sourceEnd);
const changed = before.source.pins.filter((pin, index) => pin.raw !== current.source.pins[index].raw);
assert.deepEqual(changed.map((pin) => pin.path), overlay.pins.map((pin) => pin.path));
for (const pin of overlay.pins) {
	assert.equal(sha(gitBlob(HISTORICAL, pin.path)), pin.historicalRaw);
	assert.equal(sha(read(`acceptance/overlay-backup/${safeRelative(pin.backup)}`)), pin.currentRaw);
	assert.equal(before.source.pins.find((item) => item.path === pin.path)?.raw, pin.historicalRaw);
}
assert.equal(sha(read("acceptance/compare.mjs")), before.harnessSha256);
assert.equal(sha(read("acceptance/compare-before-initial-source.mjs")), current.harnessSha256);
assert.equal(sha(read("acceptance/common.mjs")), before.commonSha256); assert.equal(current.commonSha256, before.commonSha256);
assert.equal(before.expiryRows.length, 6); assert.ok(before.expiryRows.every((item) => !item.href.includes("?category=")));
assert.ok(json("acceptance/matched-before-initial-category-selector.json").failure);
assert.ok(json("acceptance/matched-before-initial-two-headings.json").failure);
for (const [phase, result, count] of [["before", before, 2], ["current", current, 1]]) {
	assert.equal(result.status, "captured"); assert.deepEqual(result.errors, []); assert.equal(result.captures.length, 3); nextClean(result.next);
	for (const capture of result.captures) {
		assert.equal(capture.screenshotViewportOnly, true); assert.equal(capture.documentWidth, capture.viewport.width);
		assert.equal(capture.fontStatus, "loaded");
		const recorded = manifest.comparison[phase].captures.find((item) => item.file === capture.file);
		assert.equal(recorded.sha256, capture.sha256); assert.equal(recorded.h1DomCount, count);
		if (phase === "current" && capture.viewport.width > 390) {
			for (const geometry of [capture.before, capture.after]) assert.deepEqual([geometry.h1.left, geometry.main.left, geometry.sidebar.width], [280, 256, 256]);
		}
	}
}

const native = json("acceptance/native-03.json");
verifySnapshot(native.source); assert.equal(native.status, "actual-target-tree-observed");
assert.equal(sha(read("acceptance/native.mjs")), native.harnessSha256);
assert.deepEqual(native.auth, { code: 0, signIn: 200, active: 200 });
for (const name of ["open", "target", "wait", "tree", "snapshot"]) assert.equal(native.commands.find((item) => item.name === name).code, 0);
assert.ok(parseNative(native.commands.find((item) => item.name === "tree")).data.tree.includes("PersonnelFilesWorkspace"));
assert.equal(native.close.code, 0); assert.equal(parseNative(native.close).data.closed, true);
const permission = native.commands.find((item) => item.name === "permission");
assert.equal(permission.code, 1); assert.ok(parseNative(permission).error.includes("ReferenceError: Notification is not defined"));
for (const file of ["native-01.json", "native-02.json"]) assert.ok(json(`acceptance/${file}`).failure);
const cleanup = json("acceptance/process-cleanup-final.json");
assert.equal(cleanup.ownedNextPortClosed, true); assert.equal(cleanup.allOwnedForegroundRunsExited, true);
assert.deepEqual([cleanup.ownedRuntimeProcesses, cleanup.ownedNativeProcesses], [0, 0]);
assert.ok(cleanup.nativeSessions.every((item) => !item.listenerPresent && !item.daemonPresent));
assert.equal(manifest.cleanup.ownedServicesRemaining, 0); assert.ok(manifest.cleanup.containers.every((item) => item.present === false));
assert.equal(manifest.cleanup.nextBefore.portClosed, true); assert.equal(manifest.cleanup.nextAfter.portClosed, true);

// Verify preservation directly from fixed Git trees, not only retained counters.
const git=args=>execFileSync('git',['--no-optional-locks','-C',repo,...args],{maxBuffer:32*1024*1024});
const tree=rev=>new Map(git(['ls-tree','-r','-z',rev]).toString('utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('\t');return[s.slice(i+1),s.slice(0,i)];}));
const oldTree=tree(PROVISIONAL),newTree=tree(SOURCE),changedPaths=new Set();let preservedPaths=0;
for(const[p,v]of oldTree){assert.ok(newTree.has(p));if(newTree.get(p)!==v)changedPaths.add(p);else preservedPaths++;}for(const p of newTree.keys())if(!oldTree.has(p))changedPaths.add(p);
const preserved=json('preservation.json');assert.equal(preservedPaths,15038);assert.equal(changedPaths.size,8);assert.deepEqual([...changedPaths].sort(),preserved.changedSourcePaths);
const ledger=JSON.parse(gitBlob(PROVISIONAL,'docs/design/rollout-1692/integration.json').toString('utf8').replace(/^\ufeff/,''));const ancestors=ledger.tickets.filter(t=>t.verifiedCommit).map(t=>({issue:t.issue,commit:t.verifiedCommit}));assert.equal(ancestors.length,51);assert.deepEqual(preserved.verifiedAncestors,ancestors);for(const a of ancestors)git(['merge-base','--is-ancestor',a.commit,SOURCE]);
for(const[ticket,count]of [[1728,100],[1835,203],[1737,211],[1736,266]]){const paths=[...oldTree.keys()].filter(p=>p.startsWith('docs/design/rollout-1692/'+ticket+'/'));assert.equal(paths.length,count);for(const p of paths)assert.equal(oldTree.get(p),newTree.get(p));}
const oldTemplate=JSON.parse(gitBlob(SOURCE,'docs/design/rollout-1692/1835/root-template-integrity/source-pins.json').toString('utf8'));for(const[p,h]of Object.entries(oldTemplate.sourcePins))assert.equal(sha(lf(gitBlob(SOURCE,p))),h);
for(const f of json('copy-manifest.json').files){const b=read(safeRelative(f.path));assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);}assert.equal(json('sensitive-exclusion.json').passed,true);
let parsedJSON=0,checkedScripts=0,parsedTypeScript=0;const requireForSyntax=createRequire(join(repo,'apps/webapp/package.json')),babel=requireForSyntax('next/dist/compiled/babel/core');
function syntaxWalk(directory){for(const e of readdirSync(directory,{withFileTypes:true})){const p=join(directory,e.name);assert.equal(e.isSymbolicLink(),false);assert.ok(!/private|fixture.*pointer/i.test(e.name));if(e.isDirectory())syntaxWalk(p);else if(e.name.endsWith('.json')){JSON.parse(readFileSync(p,'utf8').replace(/^\ufeff/,''));parsedJSON++;}else if(e.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',p],{stdio:'pipe',maxBuffer:1024*1024});checkedScripts++;}else if(/\.tsx?$/.test(e.name)){assert.ok(babel.parseSync(readFileSync(p,'utf8'),{filename:p,configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx']}}));parsedTypeScript++;}}}
syntaxWalk(archive);

// Full decode of every archived PNG catches truncation beyond valid PNG headers.
assert.deepEqual(json("dependency-proof.json"), JSON.parse(gitBlob(SOURCE, "docs/design/rollout-1692/1737/root-scope-and-pdf/dependency-proof.json").toString("utf8").replace(/^\ufeff/, "")));
const requireWeb = createRequire(join(repo, "apps/webapp/package.json"));
const sharp = requireWeb("sharp");
for (const item of index.files.filter((entry) => entry.path.endsWith(".png"))) {
	const { info, data } = await sharp(read(`acceptance/${safeRelative(item.path)}`), { failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
	assert.ok(info.width > 0 && info.height > 0, item.path);
	assert.equal(data.length, info.width * info.height * info.channels);
	const capture = [...before.captures, ...current.captures, ...runtime.captures].find((entry) => entry.file === item.path);
	if (capture) assert.deepEqual([info.width, info.height], [capture.viewport.width, capture.viewport.height], item.path);
}
if (flags.has("--local-dependencies")) {
	const dependencies = json("dependency-proof.json");
	for(const p of dependencies.physicalRoots)assert.equal(lstatSync(join(repo,p)).isSymbolicLink(),false);
	assert.equal(dependencies.hashes.length, 6); assert.equal(dependencies.links.length, 158);
	for (const item of dependencies.hashes) assert.equal(sha(readFileSync(join(repo, item.path))), item.sha256, item.path);
	for (const item of dependencies.links) {
		const target = realpathSync(join(repo, item.path));
		assert.equal(relative(repo, target).replaceAll("\\", "/"), item.target, item.path);
		assert.ok(!relative(repo, target).startsWith(".."), "Dependency link escapes checkout");
	}
}
console.log(JSON.stringify({ status: "verified with explicit recorded qualifications", source: SOURCE, sourcePins: 19, sealedRecords: 109, publicIndexedArtifacts: 108, privateArtifactsOmitted: 1, pngsFullyDecoded: 33, parsedJSON, checkedScripts, parsedTypeScript, preservedPaths, verifiedAncestors:ancestors.length, finalCases: 477, finalPassed: 476, finalKnownBaselineFailed: 1, currentSource: flags.has("--current-source"), localDependencies: flags.has("--local-dependencies"), qualifications: manifest.limits }, null, 2));
