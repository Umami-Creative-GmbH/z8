#!/usr/bin/env node
// READ ONLY: validates bytes and syntax. Never imports or runs archived harnesses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const METADATA_SEALS = /* PUBLICATION_METADATA_SEALS */ {
  "evidence-index.json": "46ec8c96ee47525417c6b1a8ee0e860076c1c5fced82e0b1fa812316a1955a1c",
  "source-pins.json": "e0efa345bf852e995a22d499b8f1b3ddbed8aded31aeffd7d122df9f1afa5318",
  "verification-manifest.json": "1b4c886bbb7c476e8be267d050d1e75ad3f4cd833d1cb882dabaa2b80cb41fe9",
  "test-accounting.json": "fa5a44d7927ffb4a27b95cb6f6dbda9ee571ed0428cf51931b7546d1bd4033c3",
  "publication-exclusions.json": "47bf44fcbdbff4970ee90b266a570ccd41d78eb3a989ca11d574c6d1ca804609",
  "report-prefix.json": "9275435c9b3bb6a294006c1da80897fc93a7998952b78288962d364e04da263d",
  "provenance/sanitization.json": "9d93e81ca37b868d200ced5b6c87a3466a64dcd4ee1fff11853d124e9458e1fe",
  "README.md": "1d326f8c1358293d138ad0e437ea47173b4bde30a5ce3cf5e0abcd91fd690df3",
  ".gitattributes": "b6cced74e5f896eb797a8efcf96579103e5522f2674f8b1d2ee841c04fb31812",
  "provenance/runtime-public-allowlist.json": "0ff9b6d0d029d9a9abf5e72ebced6be4e008ac741609e1169077f94e1b47b44a",
  "provenance/runtime-seal.json": "b0203948d11ace5ce086e2646b1d160c772234242727b881c761c6a5edb0d69b"
};
const CANDIDATE = '3d64886be72c8935eb9dffff51d042bb426ff8dd';
const LAST_VERIFIED = 'a114c3392e2e9edb97069ddcce1c4e8d1d58c3c0';
const sha = b => createHash('sha256').update(b).digest('hex');
const lf = b => Buffer.from(b.toString('utf8').replaceAll('\r\n', '\n'));
const blob = b => createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
const archive = dirname(fileURLToPath(import.meta.url));
const archiveReal = realpathSync(archive);
let repo = archive;
while (!existsSync(join(repo, 'pnpm-workspace.yaml'))) { const parent = dirname(repo); assert.notEqual(parent, repo, 'Repository not found'); repo = parent; }
const flags = process.argv.slice(2); assert.ok(flags.every(f => f === '--current-source')); assert.ok(flags.length <= 1);
const current = flags.includes('--current-source');
function safe(p) { assert.equal(typeof p, 'string'); assert.ok(p && !isAbsolute(p) && !/[\\:\x00-\x1f]/.test(p)); assert.ok(p.split('/').every(x => x && x !== '.' && x !== '..')); return p; }
function read(p) { safe(p); const path = join(archive, p), stat = lstatSync(path), rel = relative(archiveReal, realpathSync(path)); assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..')); assert.ok(stat.isFile() && !stat.isSymbolicLink(), p); return readFileSync(path); }
const text = p => read(p).toString('utf8');
const json = p => JSON.parse(text(p));
function files(dir = archive, prefix = '') { return readdirSync(dir, { withFileTypes: true }).flatMap(e => { assert.ok(!e.isSymbolicLink()); const p = prefix + e.name; return e.isDirectory() ? files(join(dir, e.name), p + '/') : [safe(p)]; }).sort(); }
assert.equal(Object.keys(METADATA_SEALS).length, 11);
for (const [p, digest] of Object.entries(METADATA_SEALS)) assert.equal(sha(read(p)), digest, p);
const index = json('evidence-index.json'), pins = json('source-pins.json'), manifest = json('verification-manifest.json'), accounting = json('test-accounting.json');
assert.equal(index.payloadFiles, 141); assert.equal(index.files.length, 141); assert.equal(index.digest, sha(JSON.stringify(index.files)));
assert.deepEqual(Object.fromEntries(Object.entries(index.groups).map(([k, v]) => [k, v.files])), { runtime: 36, 'merger-stop': 30, static: 24, source: 15, config: 36 });
assert.equal(new Set(index.files.map(p => p.path)).size, index.files.length);
assert.equal(pins.candidate, CANDIDATE); assert.equal(pins.lastVerified, LAST_VERIFIED); assert.equal(pins.verifiedCommit, null);
assert.equal(manifest.candidate, CANDIDATE); assert.equal(manifest.lastVerified, LAST_VERIFIED); assert.equal(manifest.verifiedCommit, null);
assert.equal(pins.tree, '8c3a3993377ebde26099a95c55a2f31855791364'); assert.equal(pins.applicationTree, '4b73ae53152a8dd08703811ad2e5232b62cf6065');
assert.equal(pins.correctionSource, '81a94f940b7b7fbd13a823665b993b616973b2ae'); assert.equal(pins.sourcePins.length, 15); assert.equal(pins.configPins.length, 36);
assert.equal(text('.gitattributes'), '* -text whitespace=cr-at-eol\narchive/static/*.log whitespace=cr-at-eol,-blank-at-eof,-blank-at-eol\narchive/merger-stop/*.log whitespace=cr-at-eol,-blank-at-eof,-blank-at-eol\n');

let bytes = 0, jsonCount = 0, jsoncCount = 0, modules = 0, typed = 0;
const decodedPngs = [];
const appRequire = createRequire(join(repo, 'apps/webapp/package.json'));
const parser = createRequire(appRequire.resolve('next/package.json'))('@babel/parser');
for (const p of index.files) {
  assert.ok(p.path.startsWith('archive/')); assert.ok(Number.isSafeInteger(p.bytes) && p.bytes >= 0); assert.match(p.sha256, /^[a-f0-9]{64}$/);
  const b = read(p.path); assert.equal(b.length, p.bytes, p.path); assert.equal(sha(b), p.sha256, p.path); bytes += b.length;
  if (p.path.endsWith('.json')) {
    if (/\/tsconfig(?:\.[^/]*)?\.json$/.test(p.path)) { parseJsonc(b.toString('utf8')); jsoncCount++; }
    else { JSON.parse(b.toString('utf8')); jsonCount++; }
  }
  if (p.path.endsWith('.jsonc')) { parseJsonc(b.toString('utf8')); jsoncCount++; }
  if (p.path.endsWith('.png')) decodedPngs.push({ path: p.path, ...decodePng(b) });
  if (p.path.endsWith('.mjs')) { parser.parse(b.toString('utf8'), { sourceType: 'module', plugins: ['topLevelAwait'] }); modules++; }
  if (/\.tsx?$/.test(p.path)) { parser.parse(b.toString('utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] }); typed++; }
}
assert.equal(bytes, index.payloadBytes); assert.equal(decodedPngs.length, 11);
const allow = json('provenance/runtime-public-allowlist.json'), runtimeSeal = json('provenance/runtime-seal.json'), stopSeal = json('provenance/merger-stop-seal.json');
assert.equal(sha(read('provenance/runtime-public-allowlist.json')), '0ff9b6d0d029d9a9abf5e72ebced6be4e008ac741609e1169077f94e1b47b44a');
assert.equal(sha(read('provenance/runtime-seal.json')), 'b0203948d11ace5ce086e2646b1d160c772234242727b881c761c6a5edb0d69b');
assert.equal(sha(read('provenance/merger-stop-seal.json')), 'd7aa836a9cd8e66a3ef1778784bb67dfd0bb05f509ec02fcb64a8b1b54103917');
assert.equal(runtimeSeal.candidate, CANDIDATE); assert.equal(runtimeSeal.publicFiles, 36); assert.equal(runtimeSeal.privateRuntimeExcluded, true);
for (const [group, list, count] of [['runtime', allow.allowlist, 36], ['merger-stop', stopSeal.allowlist, 30]]) {
  assert.equal(list.length, count); assert.equal(new Set(list.map(p => p.path)).size, count);
  const prefix = 'archive/' + group + '/'; assert.deepEqual(index.files.filter(p => p.path.startsWith(prefix)).map(p => p.path.slice(prefix.length)).sort(), list.map(p => p.path).sort());
  for (const p of list) { const b = read(prefix + safe(p.path)); assert.equal(b.length, p.bytes ?? p.size); assert.equal(sha(b), p.sha256); }
}
for (const p of [...pins.sourcePins, ...pins.configPins]) {
  safe(p.path); const b = read(p.archivePath); assert.equal(b.length, p.bytes, p.path); assert.equal(sha(b), p.rawSha256, p.path); assert.equal(lf(b).length, p.lfBytes); assert.equal(sha(lf(b)), p.lfSha256, p.path); assert.equal(blob(lf(b)), p.computedCanonicalGitBlob, p.path);
  if (p.recordedGitBlob) assert.equal(p.computedCanonicalGitBlob, p.recordedGitBlob);
  if (current) { const c = readFileSync(join(repo, p.path)); assert.equal(c.length, p.bytes, p.path + ' current raw bytes'); assert.equal(sha(c), p.rawSha256, p.path + ' current raw'); assert.equal(sha(lf(c)), p.lfSha256, p.path + ' current LF'); }
}
const prefix = json('report-prefix.json'); assert.deepEqual(prefix, pins.reportOriginalPrefix);
const report = readFileSync(join(repo, prefix.path));
const rawPrefixPass = sha(report.subarray(0, prefix.bytes)) === prefix.rawSha256;
const canonicalPrefixPass = sha(report.subarray(0, prefix.lfBytes)) === prefix.lfSha256;
assert.ok(rawPrefixPass || canonicalPrefixPass, 'Original report prefix changed');
assert.equal([...report.toString('utf8').matchAll(/^## Root integration verification and unlink lifetime\r?$/gm)].length, 1);

function unit(p) {
  const r = json(p), cases = [], physicalFiles = [];
  for (const result of r.testResults) {
    const name = result.name.replaceAll('\\', '/'), i = name.lastIndexOf('apps/webapp/'); assert.ok(i >= 0); const file = name.slice(i); physicalFiles.push(file); const occurrences = new Map();
    for (const a of result.assertionResults) { const occurrence = (occurrences.get(a.fullName) ?? 0) + 1; occurrences.set(a.fullName, occurrence); cases.push({ file, fullName: a.fullName, occurrence, status: a.status }); }
  }
  assert.equal(new Set(physicalFiles).size, physicalFiles.length); assert.equal(cases.length, r.numTotalTests); assert.equal(cases.filter(c => c.status === 'passed').length, r.numPassedTests); assert.equal(cases.filter(c => c.status === 'failed').length, r.numFailedTests);
  return { path: p, reported: { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, pending: r.numPendingTests, todo: r.numTodoTests }, physicalFiles, cases };
}
const root = unit('archive/static/unit-final.sanitized.json');
assert.deepEqual(root, (({ originalRawSha256, ...r }) => r)(accounting.root));
assert.deepEqual(root.reported, { total: 509, passed: 509, failed: 0, pending: 0, todo: 0 }); assert.equal(root.physicalFiles.length, 70);
for (const r of accounting.historicalRootStages) assert.deepEqual(unit(r.path), (({ originalRawSha256, ...v }) => v)(r));
assert.deepEqual(accounting.historicalRootStages.map(r => [r.reported.total, r.reported.passed, r.reported.failed, r.reported.pending]), [[1, 0, 1, 0], [1, 1, 0, 0], [2, 1, 1, 0], [17, 17, 0, 0], [4, 1, 1, 2], [19, 19, 0, 0], [8, 8, 0, 0]]);
assert.match(text('archive/static/unlink-identity-red.sanitized.log'), /"settledBeforeRelease":0/); assert.match(text('archive/static/unlink-identity-red.sanitized.log'), /expected 2 to be 1/);
const fresh = json('archive/runtime/test-accounting.json'); assert.deepEqual(fresh, accounting.fresh);
assert.deepEqual(fresh.allMultiset, { runs: 7, caseInstances: 198, passed: 197, failed: 1, fileExecutions: 18 });
assert.deepEqual(fresh.finalAccepted, { independentNewPublicCases: 9, independentNewPublicPhysicalFiles: 1, protectedRechecks: 40, protectedPhysicalFiles: 5, canonicalPostgres: 65, canonicalPostgresPhysicalFiles: 3, protectedPayslipPostgres: 20, protectedPostgresPhysicalFiles: 1, distinctCases: 134, distinctPhysicalFiles: 10 });
const results = json('archive/runtime/test-results.json');
const runCases = name => { const run = results.runs.find(r => r.name === name); assert.ok(run); return run.files.flatMap(f => { const seen = new Map(); return f.cases.map(c => { const occurrence = (seen.get(c.name) ?? 0) + 1; seen.set(c.name, occurrence); return { file: 'apps/webapp/' + f.path, fullName: c.name, occurrence, status: c.status }; }); }); };
for (const run of fresh.runs) {
  const actual = results.runs.find(r => r.name === run.name); assert.ok(actual); const cases = actual.files.flatMap(f => f.cases);
  assert.equal(actual.reportRawSha256, run.reportRawSha256); assert.equal(cases.length, run.cases); assert.equal(cases.filter(c => c.status === 'passed').length, run.passed); assert.equal(cases.filter(c => c.status === 'failed').length, run.failed); assert.equal(actual.files.length, run.physicalFileExecutions);
}
assert.deepEqual([fresh.runs[0].cases, fresh.runs[0].passed, fresh.runs[0].failed], [8, 7, 1]);
assert.deepEqual([fresh.runs.find(r => r.name === 'public-final').cases, fresh.runs.find(r => r.name === 'public-final').physicalFileExecutions], [40, 5]);
const pg = runCases('postgres'), independent = runCases('public-nine-final'), protectedCases = runCases('protected-focused');
const key = c => c.file + '\0' + c.fullName + '\0' + c.occurrence;
assert.equal(pg.length, 85); assert.ok(pg.every(c => c.status === 'passed')); assert.equal(new Set(pg.map(c => c.file)).size, 4);
const union = [...root.cases, ...pg]; assert.deepEqual(union, accounting.primarySelection.cases); assert.equal(new Set(union.map(key)).size, 594); assert.equal(new Set(union.map(c => c.file)).size, 74);
assert.deepEqual(independent, accounting.independentNew.cases); assert.equal(independent.length, 9); assert.ok(independent.every(c => c.status === 'passed'));
assert.deepEqual(protectedCases, accounting.protectedOverlap.cases); assert.ok(protectedCases.every(c => root.cases.some(x => key(x) === key(c)))); assert.equal(accounting.protectedOverlap.additive, false);
const checks = json('archive/static/checks.json'), quality = json('archive/static/quality.sanitized.json');
assert.deepEqual([checks.types.typegen, checks.types.projects, checks.types.exit], [true, 3, 0]);
assert.deepEqual([checks.quality.lintFiles, checks.quality.lintExit, checks.quality.ownedExistingFormat80CrlfExit, checks.quality.ownedNewFormat100CrlfExit, checks.quality.fullFormat100Exit, checks.quality.fullFormat100Files, checks.quality.ordinaryExit, checks.quality.ordinaryFiles], [9, 0, 0, 0, 1, 7, 1, 3]);
assert.deepEqual([checks.quality.doctor.files, checks.quality.doctor.errors, checks.quality.doctor.warnings, checks.quality.doctor.exit], [9, 0, 0, 0]);
assert.deepEqual(quality.checks.map(c => [c.name, c.exit]), [['lint', 0], ['format-existing-80', 0], ['format-new-100', 0], ['format-all-100', 1], ['ordinary', 1]]);
assert.match(text('archive/static/format-all-100.log'), /Found 7 errors/); assert.match(text('archive/static/ordinary.log'), /Found 3 errors/);
assert.equal([...text('archive/static/format-all-100.log').matchAll(/^src[^\r\n]* format /gm)].length, 7);
assert.equal([...text('archive/static/ordinary.log').matchAll(/^src[^\r\n]* format /gm)].length, 3);
for (const re of [/next typegen/, /tsconfig\.typecheck\.json/, /tsconfig\.workflow-contracts\.json/, /tsconfig\.smoke\.json/, /Types generated successfully/]) assert.match(text('archive/static/typecheck.log'), re);
assert.match(text('archive/static/doctor.sanitized.log'), /Scanned 9 files/); assert.match(text('archive/static/doctor.sanitized.log'), /No issues found/); assert.match(text('archive/static/doctor.sanitized.log'), /Full diagnostics written to \[PRIVATE_DIAGNOSTIC_PATH\]/);
const sanitize = json('provenance/sanitization.json'); assert.equal(sanitize.records.length, 13);
for (const p of sanitize.records) { const b = read(p.clone); assert.equal(b.length, p.cloneBytes); assert.equal(sha(b), p.cloneSha256); assert.ok(p.applied.length); const entry = index.files.find(x => x.path === p.clone); assert.equal(entry.originalRawSha256, p.originalRawSha256); assert.equal(entry.originalBytes, p.originalBytes); if (p.clone.endsWith('.log')) assert.match(b.toString('utf8'), /^\[SANITIZED PUBLIC CLONE:/); assert.ok(!/[A-Z]:[\\/](?:Users[\\/]|t3-code[\\/])/i.test(b.toString('utf8'))); }

const observations = json('archive/runtime/runtime-observations.json'), readbacks = json('archive/runtime/readbacks.json');
assert.deepEqual([observations.protectedOfficerDownload.status, observations.protectedOfficerDownload.bytes, observations.selfDownload.selfDownloadStatus, observations.selfDownload.bytes], [200, 68, 200, 68]);
assert.equal(observations.protectedOfficerDownload.sha256, observations.selfDownload.sha256); assert.equal(observations.heldTransport.count, 1); assert.equal(observations.heldTransport.syntheticTransportBoundary, true); assert.equal(observations.retiredCompletion.retiredSuccessToast, false);
assert.equal(observations.officerAdmission.ownEmployeeVisible, false); assert.equal(observations.officerAdmission.formerVisible, true); assert.equal(observations.foreignTarget.foreignTargetUnavailable, true); assert.equal(observations.actualLocalReadRetry.visibleRetry, true);
assert.equal(readbacks.prematureUnconfirmedLinkAttempt.accepted, false); assert.equal(readbacks.final.refusedDraftPersistedDocuments, 0); assert.equal(readbacks.absenceRecordsUnchanged, true); assert.equal(readbacks.historyUnchanged, true);
for (const p of Object.values(readbacks).filter(x => x && typeof x === 'object' && 'absences' in x)) { assert.equal(p.absences, 12); assert.equal(p.absenceRecordsSha256, readbacks.postIntake.absenceRecordsSha256); assert.equal(p.historySha256, readbacks.postIntake.historySha256); }
assert.equal(readbacks.crossViewUnlinked.documents[0].linkedAbsenceId, null); assert.equal(readbacks.final.documents[0].linkedAbsenceId, readbacks.postIntake.documents[0].linkedAbsenceId); assert.equal(readbacks.final.documents[0].id, readbacks.postIntake.documents[0].id);
const next = json('archive/runtime/next-current.json'), native = json('archive/runtime/native-current.json');
assert.deepEqual(next.ui.headings, ['Sick leave']); assert.equal(next.ui.recordRows, 10); assert.equal(next.ui.font, '18px'); assert.equal(next.postRestore, true); assert.equal(next.browserConnectedAtObservation, true);
assert.deepEqual(JSON.parse(next.compilation[0].result.content[0].text), { issues: [] }); assert.deepEqual(JSON.parse(next.errors[0].result.content[0].text), { configErrors: [], sessionErrors: [] });
assert.equal(native.actualAdmittedTarget, true); assert.equal(native.reactSuccess, true); assert.equal(native.restoreStatus, 'not_configured'); assert.equal(native.restoreSave, 'never');
const preservation = json('archive/runtime/preservation.json');
assert.deepEqual([preservation.rawTrackedFilesCompared, preservation.rawTrackedFilesChanged, preservation.verifiedAncestors, preservation.dependencyParents.length, preservation.internalLeafLinks, preservation.licenses.count, preservation.originalStop.filesVerified, preservation.ownBridgesRemoved], [13577, 0, 57, 3, 158, 125, 30, 3]);
assert.equal(preservation.r051VerifiedCommit, null); assert.equal(preservation.resources.zeroOwnedRuntimeResources, true);
const pngPins = json('archive/runtime/artifact-validation.json').pngs;
for (const p of decodedPngs) { const pin = pngPins.find(x => 'archive/runtime/' + x.path === p.path); assert.ok(pin); assert.equal(p.width, pin.width); assert.equal(p.height, pin.height); assert.equal(p.decodedBytes, pin.decodedBytes); assert.equal(p.channels, pin.channels); }

let links = 0;
const markdownFiles = ['README.md', ...index.files.map(p => p.path).filter(p => p.endsWith('.md'))];
for (const p of markdownFiles) for (const match of text(p).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
  const target = match[1]; if (/^(?:https?:|#)/i.test(target)) continue;
  const filePart = decodeURIComponent(target.split('#')[0]); const resolved = resolve(archive, dirname(p), filePart), rel = relative(repo, resolved);
  assert.ok(!isAbsolute(rel) && !rel.startsWith('..'), 'Markdown link leaves repository'); assert.ok(existsSync(resolved), 'Missing local link ' + p + ' -> ' + target); links++;
  if (target.includes('#') && resolved.endsWith('1734.md')) assert.match(readFileSync(resolved, 'utf8'), /^## Root integration verification and unlink lifetime\r?$/m);
}
const seal = json('publication-seal.json'); assert.equal(seal.excludesSelf, true); assert.equal(seal.digest, sha(JSON.stringify(seal.files))); assert.equal(new Set(seal.files.map(p => p.path)).size, seal.files.length);
assert.deepEqual(files(), [...seal.files.map(p => safe(p.path)), 'publication-seal.json'].sort());
for (const p of seal.files) { const b = read(p.path); assert.equal(b.length, p.bytes, p.path); assert.equal(sha(b), p.sha256, p.path); if (!p.path.startsWith('archive/') && p.path.endsWith('.json')) JSON.parse(b.toString('utf8')); }
console.log(JSON.stringify({ status: 'verified', candidate: CANDIDATE, verifiedCommit: null, currentSourceChecked: current, payloadFiles: index.files.length, payloadBytes: bytes, indexDigest: index.digest, archiveFiles: seal.files.length + 1, outerSealDigest: seal.digest, originalRuntimeFiles: 36, originalStopFiles: 30, sourcePins: 15, configPins: 36, sanitizedClones: 13, rootUnitCases: 509, rootUnitFiles: 70, freshDistinctCases: 134, freshDistinctFiles: 10, allAttemptInstances: 198, allAttemptPass: 197, allAttemptFail: 1, selectedUnionCases: 594, selectedUnionFiles: 74, independentPublicCases: 9, independentPublicFiles: 1, protectedAdditive: false, parsedPayloadJson: jsonCount, parsedPayloadJsonc: jsoncCount, syntaxParsedModules: modules, syntaxParsedTypedFiles: typed, fullyDecodedPngs: decodedPngs.length, decodedPixelBytes: decodedPngs.reduce((n, p) => n + p.decodedBytes, 0), localMarkdownLinks: links, rawReportPrefix: rawPrefixPass, canonicalReportPrefix: canonicalPrefixPass, formatterBoundariesAccepted: false, privateInputsRead: false, archivedHarnessesExecuted: 0, applicationTestsRerun: 0, servicesStarted: 0, gitOperations: 0, fileWrites: 0, readinessAdvanced: false }));

// JSONC lexer removes comments and trailing commas only outside strings.
function parseJsonc(input) {
  let output = '', string = false, escape = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (string) { output += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; continue; }
    if (c === '"') { string = true; output += c; continue; }
    if (c === '/' && n === '/') { while (i < input.length && input[i] !== '\n') i++; output += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) { if (input[i] === '\n') output += '\n'; i++; } assert.ok(i < input.length, 'Unclosed JSONC comment'); i++; continue; }
    output += c;
  }
  let cleaned = ''; string = false; escape = false;
  for (let i = 0; i < output.length; i++) { const c = output[i]; if (string) { cleaned += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; } else { if (c === '"') string = true; if (c === ',') { let j = i + 1; while (/\s/.test(output[j] ?? '') && j < output.length) j++; if (output[j] === ']' || output[j] === '}') continue; } cleaned += c; } }
  return JSON.parse(cleaned.replace(/^\uFEFF/, ''));
}
// Complete RGB/RGBA8 noninterlaced PNG pixel reconstruction for these 11 pins.
// Every chunk CRC, stream length, scanline filter and reconstructed pixel is read.
function decodePng(b) {
  assert.ok(b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  let offset = 8, header, ended = false; const streams = [];
  while (offset < b.length) { assert.ok(offset + 12 <= b.length); const length = b.readUInt32BE(offset), end = offset + 12 + length; assert.ok(end <= b.length); const type = b.toString('ascii', offset + 4, offset + 8), data = b.subarray(offset + 8, end - 4); assert.equal(crc(b.subarray(offset + 4, end - 4)), b.readUInt32BE(end - 4), 'PNG CRC ' + type); if (type === 'IHDR') { assert.equal(header, undefined); assert.equal(length, 13); header = Buffer.from(data); } if (type === 'IDAT') streams.push(data); if (type === 'IEND') { assert.equal(length, 0); ended = true; offset = end; break; } offset = end; }
  assert.ok(header && ended && streams.length); assert.equal(offset, b.length);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), channels = { 2: 3, 6: 4 }[header[9]];
  assert.ok(width > 0 && height > 0 && width * height < 100000000 && channels); assert.equal(header[8], 8); assert.equal(header[10], 0); assert.equal(header[11], 0); assert.equal(header[12], 0);
  const stride = width * channels, pixels = Buffer.alloc(stride * height), raw = inflateSync(Buffer.concat(streams), { maxOutputLength: (stride + 1) * height }); assert.equal(raw.length, (stride + 1) * height);
  let cursor = 0;
  for (let y = 0; y < height; y++) { const filter = raw[cursor++]; assert.ok(filter <= 4); for (let x = 0; x < stride; x++) { const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0, prior = y ? pixels[i - stride] : 0, corner = y && x >= channels ? pixels[i - stride - channels] : 0, p = a + prior - corner, pa = Math.abs(p - a), pb = Math.abs(p - prior), pc = Math.abs(p - corner); const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? prior : filter === 3 ? Math.floor((a + prior) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? prior : corner; pixels[i] = (raw[cursor++] + predictor) & 255; } }
  assert.equal(cursor, raw.length); return { width, height, channels, decodedBytes: pixels.length, decodedPixelsSha256: sha(pixels) };
}
function crc(b) { let c = 0xffffffff; for (const value of b) { c ^= value; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
