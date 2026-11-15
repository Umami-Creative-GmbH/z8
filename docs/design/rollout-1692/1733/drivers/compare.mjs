import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const paths=['apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx','apps/webapp/src/components/personnel-file/use-payslip-batch-upload.ts','apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/[batchId]/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const saved=await Promise.all(paths.map(p=>readFile(p)));
try{
for(const p of paths)await writeFile(p,execFileSync('git',['show','63a5e6ff43e6541473a927da0a651686bfd33afe:'+p]));
const before=spawnSync(process.env.npm_execpath,['--config.verify-deps-before-run=false','node','.tmp/1733/journey.mjs','before'],{stdio:'inherit',windowsHide:true,env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
if(before.status)throw Error('Before journey failed: '+before.status);
}finally{for(let i=0;i<paths.length;i++)await writeFile(paths[i],saved[i]);}
const after=spawnSync(process.env.npm_execpath,['--config.verify-deps-before-run=false','node','.tmp/1733/journey.mjs','after'],{stdio:'inherit',windowsHide:true,env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
process.exitCode=after.status??1;
