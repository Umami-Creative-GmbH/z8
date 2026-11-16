import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const [mode,source]=process.argv.slice(2),path='apps/webapp/src/lib/effect/services/onboarding.service.ts',backup='.tmp/1835-root-checks/service-corrected-source.txt';
const canon=b=>b.toString('utf8').replaceAll('\r\n','\n'),blob=rev=>execFileSync('git',['show',rev+':'+path]);
assert.match(source,/^[a-f0-9]{40}$/);
if(mode==='before'){const current=await readFile(path);assert.equal(canon(current),canon(blob(source)));await writeFile(backup,current);await writeFile(path,canon(blob('3782c6ad3af0eff2800f39253b9a601edf7def17')).replaceAll('\n','\r\n'));}
else if(mode==='after'){assert.equal(canon(await readFile(path)),canon(blob('3782c6ad3af0eff2800f39253b9a601edf7def17')));const saved=await readFile(backup);assert.equal(canon(saved),canon(blob(source)));await writeFile(path,saved);assert.deepEqual(await readFile(path),saved);}
else throw new Error('Unknown mode');
console.log(JSON.stringify({phase:mode,source,onlyHistoricalServiceOverlay:true}));
