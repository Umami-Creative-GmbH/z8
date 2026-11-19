// Temporary page-only historical presentation comparison. Restore current bytes even on failure.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]),fixture=resolve(process.argv[3]);
const relative='apps/webapp/src/app/[locale]/onboarding/notifications/page-client.tsx',path=join(root,relative);
const current=await readFile(path),baseline=execFileSync('git',['show',`19862ee6586b4e07831c6f5a8b7e06d0f698cedd:${relative}`],{cwd:root,maxBuffer:1024*1024});
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 await writeFile(path,baseline);
 const result=spawnSync(process.execPath,[join(root,'docs/design/rollout-1692/1828/verify-runtime.mjs'),root,fixture,'before'],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exitCode=result.status||1;
}finally{
 await writeFile(path,current);
 await writeFile(join(root,'docs/design/rollout-1692/1828/comparison-source.json'),JSON.stringify({kind:'single consumer presentation overlay; rest of app current',historicalCommit:'19862ee6586b4e07831c6f5a8b7e06d0f698cedd',relative,baselineSha256:sha(baseline),restoredSha256:sha(await readFile(path)),intendedCurrentSha256:sha(current)},null,2)+'\n');
}
