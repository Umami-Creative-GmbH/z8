import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve('.'),path='apps/webapp/src/app/[locale]/onboarding/work-templates/page-client.tsx',out=resolve('.tmp/1835-root-checks');
const saved=await readFile(path),current=saved.toString('utf8').replaceAll('\r\n','\n');
const parent=execFileSync('git',['show','3782c6ad:'+path],{encoding:'utf8'});assert.ok(parent.includes('fail(result.error || fallback);'));
const start=current.indexOf('\t\t\t\t\tfail(\n'),end=current.indexOf('\n\t\t\t\t\treturn;',start);assert.ok(start>0&&end>start);
const historicalMessage=current.slice(0,start)+'\t\t\t\t\tfail(result.error || fallback);'+current.slice(end);
let child;
try{
 await writeFile(path,historicalMessage.replaceAll('\n','\r\n'));
 child=spawnSync(process.env.npm_execpath,['--config.verify-deps-before-run=false','exec','vitest','run','--project','unit','--maxWorkers','1','src/app/[locale]/onboarding/work-templates/submission-arrival.test.tsx','-t','safe retry message after a database refusal','--reporter=json','--outputFile='+join(out,'safe-message-red.json')],{cwd:resolve('apps/webapp'),env:{...process.env,pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 await writeFile(join(out,'safe-message-red.log'),(child.stdout??'')+(child.stderr??''));
}finally{await writeFile(path,saved);}
assert.deepEqual(await readFile(path),saved);
const tests=JSON.parse(await readFile(join(out,'safe-message-red.json'),'utf8'));assert.equal(tests.numFailedTests,1);assert.equal(tests.numPassedTests,0);
await writeFile(join(out,'safe-message-red-source.json'),JSON.stringify({qualifiedHistoricalMessageOnly:true,parent:'3782c6ad3af0eff2800f39253b9a601edf7def17',path,currentCanonicalSha256:createHash('sha256').update(current).digest('hex'),redCanonicalSha256:createHash('sha256').update(historicalMessage).digest('hex'),restoredByteExactly:true},null,2)+'\n');
console.log(JSON.stringify({failed:tests.numFailedTests,restoredByteExactly:true}));
