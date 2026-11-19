// Historical public page regression; other app source stays current and bytes restore in finally.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]),relative='apps/webapp/src/app/[locale]/onboarding/notifications/page-client.tsx',path=join(root,relative);
const current=await readFile(path);
try{
 await writeFile(path,execFileSync('git',['show',`19862ee6586b4e07831c6f5a8b7e06d0f698cedd:${relative}`],{cwd:root}));
 const result=spawnSync(process.execPath,[join(root,'apps/webapp/node_modules/vitest/vitest.mjs'),'run','--root',join(root,'apps/webapp'),'--project','unit','src/app/[locale]/onboarding/notifications/page.test.tsx','-t','never stores','--reporter=json','--outputFile='+join(root,'docs/design/rollout-1692/1828/permission-red.json')],{cwd:root,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},stdio:'inherit',windowsHide:true});
 if(result.status!==1)throw Error('Expected both historical literal-permission regressions to fail; inspect report.');
}finally{await writeFile(path,current);}
