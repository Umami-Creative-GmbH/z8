import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = 'apps/webapp/src/components/settings/work-balance/opening-balance-upload-dialog.tsx';
const base = '19862ee6586b4e07831c6f5a8b7e06d0f698cedd';
const directory = resolve('.tmp/1726-root-checks');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const original = execFileSync('git', ['show', `${base}:${source}`]);
assert.equal(execFileSync('git', ['branch', '--show-current'], {encoding:'utf8'}).trim(), 'fix/1726-upload-activity-recovery');
if (process.argv[2] === 'before') {
  const after = await readFile(source);
  assert.notEqual(sha(after), sha(original));
  await writeFile(`${directory}/upload-after.tsx.txt`, after);
  await writeFile(`${directory}/upload-before.tsx.txt`, original);
  await writeFile(`${directory}/source-overlay.json`, JSON.stringify({source, base, before:sha(original), after:sha(after)}, null, 2)+'\n');
  await writeFile(source, original);
} else if (process.argv[2] === 'restore') {
  const pin = JSON.parse(await readFile(`${directory}/source-overlay.json`, 'utf8'));
  assert.equal(sha(await readFile(source)), pin.before, 'Unexpected intervening source edit; do not overwrite');
  const after = await readFile(`${directory}/upload-after.tsx.txt`);
  assert.equal(sha(after), pin.after);
  await writeFile(source, after);
  assert.equal(sha(await readFile(source)), pin.after);
} else throw Error('Use before or restore');
console.log('Applied the checked, single-file source overlay.');
