import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const file='apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx';
const saved=await readFile(file),sha=x=>createHash('sha256').update(x).digest('hex');
const old=execFileSync('git',['show','25865312d95c68ec1eaed75363e953745f168802:'+file]);
const output=resolve('.tmp/1830-root-checks/red-boundaries.json');
try {
 await writeFile(file,old);
 const args=['--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1','src/app/[locale]/onboarding/profile/page.test.tsx','-t','discards Save queued before','--reporter=json','--outputFile='+output];
 const cli=process.env.npm_execpath;
 const r=spawnSync(cli.endsWith('.exe')?cli:process.execPath,cli.endsWith('.exe')?args:[cli,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},maxBuffer:32*1024*1024});
 await writeFile('.tmp/1830-root-checks/red-boundaries.log',(r.stdout??'')+(r.stderr??''));
 const report=JSON.parse(await readFile(output,'utf8'));
 assert.equal(r.status,1);assert.equal(report.numFailedTests,4);
 const failed=report.testResults.flatMap(x=>x.assertionResults).filter(x=>x.status==='failed');
 assert.ok(failed.every(x=>x.failureMessages.some(m=>m.includes('to not be called at all'))));
 await writeFile('.tmp/1830-root-checks/red-source.json',JSON.stringify({source:'25865312d95c68ec1eaed75363e953745f168802',path:file,oldSha256:sha(old),fixedSha256:sha(saved),argv:['pnpm',...args],failed:failed.map(x=>x.fullName)},null,2)+'\n');
 console.log('Four queued-submit regressions fail against the exact pre-correction client.');
} finally {await writeFile(file,saved);assert.equal(sha(await readFile(file)),sha(saved));}
