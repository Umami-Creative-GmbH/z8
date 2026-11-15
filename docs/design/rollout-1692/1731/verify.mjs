import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repo = process.cwd(), out = 'docs/design/rollout-1692/1731';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const json = async name => JSON.parse((await readFile(join(out, name), 'utf8')).replace(/^\uFEFF/, ''));
const ancestors = ['9f839b78f109b1f3eea1c40b959e76ae99efba3b', '1fb2263e97bf266522f1cf50be957889383701cd', '26d1d8fd016d6daa0c9fe71e0f671571dd45c211', '511ecaaacf5a4d864f0968dec3537172023beb63', 'efe20505cd56170b204b0d2b763479549a38bfb0'];
for (const ancestor of ancestors) git('merge-base', '--is-ancestor', ancestor, 'HEAD');
assert.equal(git('rev-parse', `${ancestors[0]}^{tree}`), 'b3c2aa2f972dfac76153051fe957f24558a4f9b0');
const sources = [
  'apps/webapp/src/app/[locale]/(app)/personnel-files/due-for-deletion/page.tsx',
  'apps/webapp/src/app/[locale]/(app)/personnel-files/due-for-deletion/page.test.tsx',
  'apps/webapp/src/app/[locale]/(app)/personnel-files/retention-actions.ts',
  'apps/webapp/src/components/personnel-file/due-for-deletion-list.tsx',
  'apps/webapp/src/components/personnel-file/due-for-deletion-list.test.tsx',
  'apps/webapp/src/components/personnel-file/due-for-deletion-heading.tsx',
  'apps/webapp/src/lib/personnel-file/retention.integration.test.ts',
  'apps/webapp/src/lib/navigation/route-metadata.ts',
];
const pins = [];
for (const path of sources) {
  const bytes = await readFile(path);
  pins.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), canonicalSha256: createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex'), gitBlob: git('hash-object', '--path', path, path) });
}
const units = await json('unit-expanded.json'), label = await json('unit-label-final.json');
assert.equal(units.success, true); assert.equal(units.testResults.length, 43); assert.equal(units.numPassedTests, 282);
assert.equal(label.success, true); assert.equal(label.testResults.length, 2); assert.equal(label.numPassedTests, 18);
const pg = await json('postgres.json'), access = await json('postgres-access.json');
assert.equal(pg.success, true); assert.equal(access.success, true);
assert.equal(pg.testResults.length + access.testResults.length, 5); assert.equal(pg.numPassedTests + access.numPassedTests, 83);
assert.equal((await json('types-touch-command.json')).exit, 0);
for (const result of await json('biome-final-commands.json')) assert.equal(result.exit, 0);
const cleanup = await json('cleanup-services.json');
assert.equal(cleanup.exit, 0); assert.equal(cleanup.containers.length, 3); assert.equal(cleanup.remaining.length, 0); assert.equal(cleanup.listeners.length, 0);
assert.equal(createHash('sha256').update(await readFile('pnpm-lock.yaml')).digest('hex').toUpperCase(), '2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
for (const path of ['node_modules', 'apps/webapp/node_modules', 'node_modules/.pnpm']) {
  assert.equal((await lstat(path)).isSymbolicLink(), false);
  assert.equal(await realpath(path), resolve(path));
}
const packageLinks = [];
for (const parent of ['node_modules', 'apps/webapp/node_modules']) {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const candidates = entry.name.startsWith('@') ? (await readdir(join(parent, entry.name))).map(name => join(parent, entry.name, name)) : [join(parent, entry.name)];
    for (const path of candidates) {
      const target = await realpath(path);
      assert.ok(target.startsWith(resolve(repo) + '\\'), `Foreign dependency target at ${path}`);
      packageLinks.push({ path, target });
    }
  }
}
let artifactJson = 0;
for (const name of await readdir(out)) if (name.endsWith('.json')) { await json(name); artifactJson++; }
git('diff', '--check');
const evidence = {
  headAtVerification: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), checkout: repo,
  ancestors, requiredBaseTree: 'b3c2aa2f972dfac76153051fe957f24558a4f9b0', source: pins,
  tests: { unitFiles: 43, unitTests: 282, finalLabelFiles: 2, finalLabelTests: 18, labelIsOverlappingRecheck: true, postgresFiles: 5, postgresTests: 83 },
  artifactsParsed: artifactJson, capturedImages: 0, browserAcceptance: 'UNPASSED: owned Turbopack host quota error 1453 before sign-in/target; no matched captures',
  dependencies: { physicalRoots: true, packageLinks, approvedLockUnchanged: true },
  typecheck: 'pass', explicitBiome: 'pass', doctor: '0 errors / 1 reviewed Activity before-paint reset warning',
  cleanup: '3 exact label-owned containers absent; own Next tree stopped; runtime listener absent; no owned browser',
  workingTree: git('status', '--short'),
};
await writeFile(join(out, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Verified source pins, supplied ancestry, 43/282 units, 5/83 PG, exact types/lint and owned cleanup. Runtime acceptance remains UNPASSED.');
