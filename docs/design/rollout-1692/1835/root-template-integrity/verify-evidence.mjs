// Read-only verifier of the published #1835 correction evidence.
// Read-only: public files, committed Git blobs, and optional local dependencies.
// No test/driver execution, writes, credentials, fixtures, browsers, or services.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
assert.ok(args.every(a => a === '--current-source'), 'Only --current-source is supported');
const current = args.includes('--current-source');
const dir = new URL('.', import.meta.url);
const root = new URL('../../../../../', dir);
const rootPath = fileURLToPath(root);
const sourceCommit = 'cda10d3e2e42fee034ab9ad1df2bc4eafda091e8';
const baseCommit = '3782c6ad3af0eff2800f39253b9a601edf7def17';
const servicePath = 'apps/webapp/src/lib/effect/services/onboarding.service.ts';
const route = 'apps/webapp/src/app/[locale]/onboarding/work-templates/';
const sourcePaths = [
  ...['actions.ts', 'page-client.tsx', 'page.test.tsx', 'submission-arrival.test.tsx', 'atomicity.integration.test.ts'].map(p => route + p),
  servicePath,
  'apps/webapp/src/lib/user-preferences/user-settings-mutation.ts',
  'apps/webapp/src/lib/onboarding/work-template-mutation.ts',
  'apps/webapp/src/db/schema/work-policy.ts',
  'apps/webapp/src/db/schema/user-settings.ts',
  'apps/webapp/src/db/auth-schema.ts',
  'apps/webapp/src/lib/validations/onboarding.ts',
  'apps/webapp/src/lib/organization-action/settings-access.ts',
  'apps/webapp/src/lib/organization-action/settings-access-level.ts',
  'apps/webapp/src/lib/auth/organization-role.ts',
  'apps/webapp/src/lib/employee-lifecycle/current-roster.ts',
  'apps/webapp/src/lib/time-tracking/work-transaction/index.ts',
];
const expectedDigests = {
  before: 'f224b46f7884dd8fde8513a49153b93faf60d4899dab4f51a0b21b22f1e622a9',
  after: '07b0c3d1481651d4b46cbb1119c5a9d493ccb5613475d2061f378c2bd719c64d',
};
const sha = b => createHash('sha256').update(b).digest('hex');
const canon = b => b.toString('utf8').replaceAll('\r\n', '\n');
const safeRelative = p => {
  assert.ok(p && !isAbsolute(p) && !p.includes('\\') && !p.split('/').includes('..'), `Safe relative path: ${p}`);
  return p;
};
const read = p => readFile(new URL(safeRelative(p), dir));
const text = async p => (await read(p)).toString('utf8').replace(/^\ufeff/, '');
const json = async p => JSON.parse(await text(p));
const blob = (rev, p) => execFileSync('git', ['show', `${rev}:${safeRelative(p)}`], { cwd: rootPath, maxBuffer: 32 * 1024 * 1024 });
const appRequire = createRequire(new URL('apps/webapp/package.json', root));
const sharp = appRequire('sharp');
const decodePng = async b => {
  const { info, data } = await sharp(b, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data.length, info.width * info.height * 4);
  return info;
};

const pins = await json('source-pins.json');
assert.equal(Object.keys(pins.sourcePins).length, 9);
assert.deepEqual(pins.unit, { physicalFiles: 30, cases: 383 });
assert.deepEqual(pins.postgres, { physicalFiles: 1, cases: 13 });
assert.deepEqual(pins.doctor, { errors: 0, warnings: 0 });
assert.equal(pins.allCommandPinsMatch, true);
for (const [p, hash] of Object.entries(pins.sourcePins)) {
  const committed = blob(sourceCommit, p);
  assert.equal(sha(canon(committed)), hash, `Committed correction: ${p}`);
  if (current) assert.equal(canon(await readFile(new URL(p, root))), canon(committed), `Current correction: ${p}`);
}

function testCases(record, fileCount, caseCount) {
  assert.equal(record.success, true);
  assert.equal(record.numFailedTests, 0);
  assert.equal(record.numPassedTests, caseCount);
  assert.equal(record.numPendingTests, 0);
  assert.equal(record.testResults.length, fileCount, 'Physical file count, not nested suite count');
  const files = new Set(), cases = new Set();
  for (const r of record.testResults) {
    assert.equal(r.status, 'passed');
    const name = r.name.replaceAll('\\', '/');
    const start = name.lastIndexOf('/apps/webapp/');
    assert.ok(start >= 0, 'Retained result belongs to webapp');
    const p = name.slice(start + 1);
    assert.ok(!files.has(p)); files.add(p);
    for (const a of r.assertionResults) {
      assert.equal(a.status, 'passed');
      assert.deepEqual(a.failureMessages, []);
      const key = `${p}\0${a.fullName}`;
      assert.ok(!cases.has(key)); cases.add(key);
    }
  }
  assert.equal(cases.size, caseCount);
  return cases;
}
const unitCases = testCases(await json('unit.json'), 30, 383);
const pgCases = testCases(await json('pg-all.json'), 1, 13);
assert.equal(new Set([...unitCases, ...pgCases]).size, 396);
for (const name of ['unit', 'pg-all', 'types', 'lint', 'format', 'doctor', 'service-format']) {
  const c = await json(`${name}-command.json`);
  assert.equal(c.exitCode, name === 'service-format' ? 1 : 0, `${name} retained exit`);
  assert.equal(c.sourceHead, baseCommit, `${name} provisional revision qualifier`);
  for (const [p, hash] of Object.entries(c.sourcePins)) assert.equal(hash, pins.sourcePins[p]);
  if (name !== 'pg-all') assert.equal(c.argv[0], 'pnpm');
  assert.ok(!c.argv.some(a => a === '--write' || a === '--unsafe'), `${name} is a check`);
}
assert.match(await text('types.log'), /Types generated successfully/);
assert.match(await text('lint.log'), /Checked 9 files.*No fixes applied/s);
assert.match(await text('format.log'), /Checked 7 files.*No fixes applied/s);
assert.match(await text('service-format.log'), /Found 1 error/);
const doctor = await json('doctor.json');
assert.equal(doctor.sourceRevision, baseCommit);
assert.equal(doctor.summary.errorCount, 0);
assert.equal(doctor.summary.warningCount, 0);
assert.equal(doctor.projects[0].complete, true);
assert.equal(doctor.projects[0].analyzedFileCount, 7);
assert.equal(doctor.projects[0].analyzedFiles.length, 7);
assert.equal(doctor.diff.isCurrentChanges, false);

async function sourceProof(record, phase) {
  assert.equal(record.head, sourceCommit);
  assert.deepEqual(record.source.map(p => p.path), sourcePaths);
  assert.equal(new Set(record.source.map(p => p.path)).size, 17);
  for (const p of record.source) {
    const ref = phase === 'before' && p.path === servicePath ? baseCommit : sourceCommit;
    assert.equal(sha(canon(blob(ref, p.path))), p.canonicalSha256, `Runtime committed source: ${p.path}`);
    if (current && phase === 'after') assert.equal(sha(canon(await readFile(new URL(p.path, root)))), p.canonicalSha256, `Current runtime source: ${p.path}`);
    assert.match(p.bytesSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(record.historicalCanonicalSha256, sha(canon(blob(baseCommit, servicePath))));
  assert.equal(record.digest, expectedDigests[phase]);
  assert.equal(sha(record.source.map(p => p.path + '\0' + p.canonicalSha256).join('\n')), record.digest);
  const declared = await json(`declared-runtime-${phase}.json`);
  assert.equal(declared.sourceCommit, sourceCommit);
  assert.equal(declared.beforeService, baseCommit);
  assert.equal(declared.onlyHistoricalServiceOverlay, phase === 'before');
  assert.equal(declared.digest, record.digest);
  assert.deepEqual(declared.sourcePins.map(p => [p.path, p.canonicalSha256]), record.source.map(p => [p.path, p.canonicalSha256]));
  for (const p of declared.sourcePins) assert.equal(p.ref, phase === 'before' && p.path === servicePath ? baseCommit : sourceCommit);
}
function nextDiagnostics(record, path) {
  for (const name of ['get_page_metadata', 'get_compilation_issues', 'get_errors']) {
    assert.ok(record.available.includes(name));
    const entries = record.observations.filter(o => o.name === name);
    assert.equal(entries.length, 1);
    const response = entries[0].response;
    assert.ok(!response.error && !response.result.isError);
    const blocks = response.result.content.filter(c => c.type === 'text');
    assert.equal(blocks.length, 1);
    const value = JSON.parse(blocks[0].text);
    if (name === 'get_compilation_issues') assert.deepEqual(value, { issues: [] });
    if (name === 'get_errors') assert.deepEqual(value, { configErrors: [], sessionErrors: [] });
    if (name === 'get_page_metadata') {
      assert.ok(value.sessions.length > 0);
      for (const session of value.sessions) assert.equal(session.url, path);
    }
  }
}
const captures = new Set();
async function capture(folder, c, digest) {
  assert.ok(!c.filename.includes('/') && !c.filename.includes('\\'));
  const p = `${folder}/${c.filename}`;
  assert.ok(!captures.has(p)); captures.add(p);
  const b = await read(p);
  assert.equal(sha(b), c.sha256, `Canonical capture bytes: ${p}`);
  assert.equal(c.sourceDigest, digest);
  const image = await decodePng(b), m = c.measurement;
  assert.equal(image.width, m.viewport.width);
  assert.ok(image.height >= m.viewport.height);
  assert.ok(m.documentWidth <= m.viewport.width);
  assert.equal(m.headings.length, 1);
  assert.equal(m.rootFont, '16px');
  assert.ok(m.theme.split(/\s+/).includes('light'));
  assert.equal(m.visibleToasts, 0);
  assert.equal(m.path, c.state === 'accepted-recovery' ? '/en/onboarding/notifications' : '/en/onboarding/work-templates');
}
const countDelta = (a, b) => Object.fromEntries(Object.entries(a.graph.counts).map(([k, v]) => [k, b.graph.counts[k] - v]));
const unchanged = (a, b, keys) => { for (const k of keys) assert.equal(a[k], b[k], `Unchanged ${k}`); };
const records = {};
for (const phase of ['before', 'after']) {
  const folder = `runtime-${phase}-settled`, r = await json(`${folder}/work-template-runtime-${phase}.json`);
  records[phase] = r;
  assert.equal(r.phase, phase);
  assert.equal(r.status, phase === 'before' ? 'observed-historical-partial-graph' : 'accepted-recovery');
  assert.deepEqual(r.browserErrors, []);
  assert.deepEqual(r.dialogs, []);
  assert.deepEqual(r.auth, { signIn: 200, active: 200 });
  assert.deepEqual(r.source, r.sourceAtEnd);
  await sourceProof(r.source, phase);
  assert.deepEqual(Object.keys(r.harnessPins), ['runtime', 'common', 'fixture-guard', 'readback']);
  for (const [label, hash] of Object.entries(r.harnessPins)) assert.equal(sha(await read(`${folder}/${label}-source.txt`)), hash, `Harness ${phase}/${label}`);
  assert.equal(r.captures.length, phase === 'before' ? 2 : 4);
  for (const c of r.captures) await capture(folder, c, r.source.digest);
  const stages = phase === 'before' ? ['setup', 'setup', 'default'] : ['setup', 'setup', 'default', 'retry'];
  assert.deepEqual(r.actionRequests.map(x => x.stage), stages);
  assert.deepEqual(r.actionResponses.map(x => x.stage), stages);
  assert.ok(r.actionRequests.every(x => x.method === 'POST'));
  assert.ok(r.actionResponses.every(x => x.status === 200 && x.bodyBytes > 0));
  assert.deepEqual(r.actionResponses.map(x => x.actionHash), r.actionRequests.map(x => x.actionHash));
  assert.deepEqual(r.actionResponses.map(x => x.bodyBytes), phase === 'before' ? [69, 69, 133] : [69, 69, 241, 77]);
  unchanged(r.initial, r.refused, ['defaultGraphHash', 'recordedTimeHash', 'userSettingsHash', 'preferencesWithoutProgressHash', 'onboardingStep']);
  // Both initial snapshots already say wellness. Do not claim new progress here.
  assert.equal(r.initial.onboardingStep, 'wellness');
  assert.equal(r.refused.onboardingStep, 'wellness');
  assert.deepEqual(countDelta(r.initial, r.refused), phase === 'before' ? { policy: 1, schedule: 1, day: 7, assignment: 0 } : { policy: 0, schedule: 0, day: 0, assignment: 0 });
  assert.equal(r.refused.named.policyIds.length, phase === 'before' ? 1 : 0);
  assert.equal(r.cleanup.context, 'Own ephemeral context closed');
  assert.equal(r.cleanup.browser, 'Own Chromium closed');
  nextDiagnostics(r.next, phase === 'before' ? '/en/onboarding/work-templates' : '/en/onboarding/notifications');
}
assert.equal(captures.size, 6);
assert.deepEqual(records.before.initial.graph.counts, { policy: 3, schedule: 3, day: 14, assignment: 1 });
assert.deepEqual(records.before.refused.graph, records.after.initial.graph, 'Historical orphan remains in the fixture; no graph cleanup');
assert.deepEqual(records.after.initial.graph.counts, { policy: 4, schedule: 4, day: 21, assignment: 1 });
assert.deepEqual(records.after.refused.graph, records.after.initial.graph);
const accepted = records.after.accepted, initial = records.after.initial;
assert.deepEqual(countDelta(initial, accepted), { policy: 1, schedule: 1, day: 7, assignment: 0 });
unchanged(initial, accepted, ['defaultGraphHash', 'recordedTimeHash', 'preferencesWithoutProgressHash', 'onboardingStep']);
assert.notEqual(initial.userSettingsHash, accepted.userSettingsHash);
assert.equal(accepted.onboardingStep, 'wellness');
assert.equal(accepted.named.isDefault, false);
assert.equal(accepted.named.hoursPerCycle, '37.5');
for (const [key, count] of [['policyIds', 1], ['scheduleIds', 1], ['dayIds', 7]]) assert.equal(accepted.named[key].length, count);
assert.deepEqual(accepted.named.days, [...['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map(day => ({ day, isWorkDay: true, hoursPerDay: '7.5' })), ...['saturday', 'sunday'].map(day => ({ day, isWorkDay: false, hoursPerDay: '0.0' }))]);
assert.deepEqual(records.before.source.source.filter((x, i) => x.canonicalSha256 !== records.after.source.source[i].canonicalSha256).map(x => x.path), [servicePath]);
assert.deepEqual(records.before.harnessPins, records.after.harnessPins);

const native = await json('native/native-result.json');
assert.equal(native.status, 'accepted');
assert.equal(native.closed, true);
assert.deepEqual(native.auth, { active: 200, signIn: 200 });
assert.deepEqual(native.permission, { permission: 'unavailable' });
assert.deepEqual(native.source, native.sourceAtEnd);
assert.equal(native.source.sourceCommit, sourceCommit);
assert.equal(native.source.digest, expectedDigests.after);
assert.deepEqual(native.source.sourcePins.map(p => [p.path, p.canonicalSha256]), records.after.source.source.map(p => [p.path, p.canonicalSha256]));
const nativeResult = async name => {
  const r = await json(`native/${name}.json`);
  assert.equal(r.code, 0); assert.equal(r.err, '');
  const value = JSON.parse(r.out);
  assert.equal(value.success, true); assert.equal(value.error, null);
  return value.data;
};
const nativeOutputs = {};
for (const name of ['open', 'target', 'ready', 'save', 'refused', 'observation', 'permission', 'tree', 'close']) nativeOutputs[name] = await nativeResult(name);
assert.deepEqual(nativeOutputs.observation.result, { dialogs: 0, headings: ['Create work schedule template'], hours: '40', name: 'Standard', path: '/en/onboarding/work-templates' });
assert.equal(nativeOutputs.save.clicked, 'form button[type="submit"]');
assert.equal(nativeOutputs.close.closed, true);
for (const name of ['WorkTemplateSetup', 'TemplateNameField', 'HoursPerWeekField', 'WorkingDaysSelector', 'DefaultTemplateToggle', 'WorkTemplateActions', 'SchedulePreview']) assert.ok(nativeOutputs.tree.tree.includes(name));
nextDiagnostics(native.next, '/en/onboarding/work-templates');

const dep = await json('dependency-proof.json');
const configHashes = {
  'package.json': 'f281c18ac5a4b789e95cc9314145e2f1bb535aff902fd2c4a20e08256f88c2b7',
  'pnpm-workspace.yaml': '1aa995231f3055320fd3130345f21c4f6598232fe8981920f2ae6b860e376ea8',
  'pnpm-lock.yaml': '2a254a9e5731e431b5032d1b918688f5663ce837b08207e147e1808a71bb3799',
  'apps/webapp/package.json': '59bbc67934476333747162b5abcc7adac7a99db758416c9b630a09ec92ac1cc9',
  'apps/webapp/next.config.ts': 'd3a8ed855c1beee3174fef4a6dfc9112f39ae2ce5bfa39feb5250e55b0fc5d05',
  'apps/webapp/biome.jsonc': '020adb15c73e5eb1eb430629a806fe997c21f45a1ea317886027016a8c701c24',
};
assert.equal(dep.links.length, 158);
assert.equal(new Set(dep.links.map(l => l.path)).size, 158);
assert.deepEqual(Object.fromEntries(dep.hashes.map(h => [h.path, h.sha256])), configHashes);
assert.deepEqual([...dep.physicalRoots].sort(), ['node_modules', 'apps/webapp/node_modules', 'node_modules/.pnpm'].sort());
const priorDep = JSON.parse(blob(sourceCommit, 'docs/design/rollout-1692/1737/root-scope-and-pdf/dependency-proof.json').toString('utf8').replace(/^\ufeff/, ''));
assert.deepEqual(dep, priorDep, 'Dependency inventory retained from sealed 1737 proof');
const rootRelative = p => {
  safeRelative(p);
  const value = resolve(rootPath, p), rel = relative(rootPath, value);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  return value;
};
for (const [p, hash] of Object.entries(configHashes)) {

  assert.deepEqual(blob(baseCommit, p), blob(sourceCommit, p), `Config preserved: ${p}`);
  if (current) assert.equal(sha(await readFile(rootRelative(p))), hash, `Current config bytes: ${p}`);
}
if (current) {
  const physicalRoot = await realpath(rootPath), norm = p => process.platform === 'win32' ? p.toLowerCase() : p;
  for (const p of dep.physicalRoots) assert.equal((await lstat(rootRelative(p))).isSymbolicLink(), false);
  for (const l of dep.links) {
    const p = rootRelative(l.path), target = rootRelative(l.target);
    assert.equal((await lstat(p)).isSymbolicLink(), true);
    const actual = await realpath(p), expected = await realpath(target);
    assert.equal(norm(actual), norm(expected), `Exact internal dependency: ${l.path}`);
    const rel = relative(physicalRoot, actual);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Dependency stays inside root: ${l.path}`);
  }
}
const cleanup = await json('cleanup.json'), stop = await json('stop-after-settled.json');
for (const k of ['portClosed', 'removed', 'verifiedAbsent', 'ownershipLabelVerified', 'privateManifestsRetained']) assert.equal(cleanup[k], true);
assert.equal(cleanup.exactServiceCount, 3);
assert.equal(cleanup.services.length, 3);
assert.equal(cleanup.nextPort, 62642);
assert.equal(stop.port, 62642);
for (const k of ['ownedNextIdentityVerified', 'ownedNextStopped', 'portClosed', 'filteredProcessInventory']) assert.equal(stop[k], true);
assert.equal(stop.cacheMoved, false);
assert.ok(stop.stoppedPids.length > 0);

// Audit compact preservation against Git rather than trusting inventory counters.
const git = args => execFileSync('git', args, {cwd: rootPath, maxBuffer: 32*1024*1024});
const tree = rev => new Map(git(['ls-tree','-r','-z',rev]).toString('utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('\t');return[s.slice(i+1),s.slice(0,i)];}));
const oldTree=tree(baseCommit),newTree=tree(sourceCommit),changed=new Set();let preserved=0;
for(const[p,v]of oldTree){assert.ok(newTree.has(p));if(newTree.get(p)!==v)changed.add(p);else preserved++;}for(const p of newTree.keys())if(!oldTree.has(p))changed.add(p);
assert.deepEqual([...changed].sort(),Object.keys(pins.sourcePins).sort());assert.equal(preserved,14824);
const preservation=await json('preservation.json');assert.equal(preservation.base,baseCommit);assert.equal(preservation.source,sourceCommit);assert.equal(preservation.unchangedBasePaths,preserved);
const ledger=JSON.parse(blob(baseCommit,'docs/design/rollout-1692/integration.json').toString('utf8').replace(/^\ufeff/,''));
const ancestors=ledger.tickets.filter(t=>t.verifiedCommit).map(t=>({issue:t.issue,commit:t.verifiedCommit}));assert.equal(ancestors.length,50);assert.deepEqual(preservation.verifiedAncestors,ancestors);for(const a of ancestors)git(['merge-base','--is-ancestor',a.commit,sourceCommit]);
for(const[ticket,count]of [[1835,96],[1737,211]]){const paths=[...oldTree.keys()].filter(p=>p.startsWith('docs/design/rollout-1692/'+ticket+'/'));assert.equal(paths.length,count);for(const p of paths)assert.equal(oldTree.get(p),newTree.get(p));}
const copyManifest=await json('copy-manifest.json');for(const f of copyManifest.files){const b=await read(f.path);assert.equal(sha(b),f.sha256,'Unaltered retained bytes: '+f.path);assert.equal(b.length,f.bytes);}
assert.equal((await json('sensitive-exclusion.json')).passed,true);
for(const[phase,folder]of [['before','runtime-before-confirmed'],['after','runtime-after']]){const r=await json(folder+'/work-template-runtime-'+phase+'.json');await sourceProof(r.source,phase);assert.deepEqual(r.source,r.sourceAtEnd);for(const c of r.captures){const b=await read(folder+'/'+c.filename);assert.equal(sha(b),c.sha256);assert.equal(c.sourceDigest,r.source.digest);} }
const babel=appRequire('next/dist/compiled/babel/core');let scripts=0,typedSnapshots=0;

// Decode every published PNG, including the six inherited operational captures.
// Only the six settled captures above are tied to this runtime's declared hashes.
let pngs = 0, jsons = 0;
async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    assert.equal(e.isSymbolicLink(), false, 'No public evidence links');
    assert.ok(!/private|fixture.*pointer|service-corrected-source/i.test(e.name), 'Private evidence excluded');
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.png')) { await decodePng(await readFile(p)); pngs++; }
    else if (e.name.endsWith('.json')) { JSON.parse((await readFile(p, 'utf8')).replace(/^\ufeff/, '')); jsons++; }
    else if(e.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',fileURLToPath(p)],{stdio:'pipe',maxBuffer:1024*1024});scripts++;}
    else if(e.name==='readback-source.txt'||e.name.endsWith('.ts')||e.name.endsWith('.tsx')){assert.ok(babel.parseSync(await readFile(p,'utf8'),{filename:fileURLToPath(p),configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx']}}));typedSnapshots++;}
  }
}
await walk(dir);
assert.equal(pngs, 12);
console.log(JSON.stringify({ passed: true, sourceCommit, unit: { files: 30, cases: 383 }, postgres: { files: 1, cases: 13 }, uniqueCases: 396, canonicalCaptures: captures.size, decodedPNGs: pngs, parsedJSON: jsons, syntaxCheckedScripts:scripts, typedSnapshotsParsed:typedSnapshots, preservedPaths:preserved, verifiedAncestors:ancestors.length, perPhaseAppPins: 17, perPhaseHarnessPins: 4, savePosts: 3, setupPosts: 4, nativeOutputFiles: 9, doctor: { errors: 0, warnings: 0, analyzedFiles: 7 }, serviceFormatExit: 1, dependencyLinks: 158, dependencyConfigHashes: 6, currentSourceAndDependencies: current, qualifications: ['Both initial onboarding steps already equal wellness; retained progress and notifications navigation are observed', 'Historical runtime overlays only the old service on the current surrounding app', 'Doctor scans seven files at a provisional revision; service formatter failure remains', 'Native outputs have no action transport counter or native harness hash', 'Six operational PNGs also match retained byte hashes; transient overlays remain qualified'] }));
