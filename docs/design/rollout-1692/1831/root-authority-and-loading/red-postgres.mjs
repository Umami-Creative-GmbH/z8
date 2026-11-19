import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const file='apps/webapp/src/lib/effect/services/onboarding.service.ts',saved=await readFile(file),sha=b=>createHash('sha256').update(b).digest('hex');
const old=execFileSync('git',['show','699a1a782ca8f0ab2def50b31e4921fd6d17a073:'+file]);
await writeFile('.tmp/1831-root-checks/server-source-before.ts.txt',old);await writeFile('.tmp/1831-root-checks/server-source-after.ts.txt',saved);
try {
 await writeFile(file,old);
 const r=spawnSync(process.execPath,['.tmp/1831-root-checks/postgres.mjs',process.argv[2],'baseline'],{encoding:'utf8',windowsHide:true,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},maxBuffer:8*1024*1024});
 const report=JSON.parse(await readFile('.tmp/1831-root-checks/postgres-baseline.json','utf8'));assert.equal(r.status,1);assert.equal(report.numFailedTests,1);
 const failures=report.testResults.flatMap(f=>f.assertionResults).filter(t=>t.status==='failed');assert.equal(failures.length,1);assert.ok(failures[0].fullName.includes('refuses member admission'));assert.ok(failures[0].failureMessages.length>=2);
 await writeFile('.tmp/1831-root-checks/postgres-red-source.json',JSON.stringify({base:'699a1a782ca8f0ab2def50b31e4921fd6d17a073',path:file,beforeSHA256:sha(old),afterSHA256:sha(saved),expectedFailedCases:1,observedFailedAssertions:failures[0].failureMessages.length,qualification:'Actual exported actions, production service and real PostgreSQL policy/progress records; request/auth boundary fakes only. Not a live browser exploit or atomic concurrent-revocation claim.'},null,2)+'\n');
 console.log('Exact old service fails the real PostgreSQL member-create/Skip/no-write regression.');
} finally {await writeFile(file,saved);assert.equal(sha(await readFile(file)),sha(saved));}
