import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const old='.tmp/1733-command-checks/runtime/public/harness', base='.tmp/1733-final-runtime-checks',out=base+'/runtime';
fs.mkdirSync(out+'/commands',{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const sealed=[];
for(const root of ['.tmp/1733-root-checks/runtime','.tmp/1733-command-checks/runtime']){
 const allow=JSON.parse(fs.readFileSync(root+'/public-allowlist.json','utf8'));
 for(const p of allow.files)sealed.push({path:root+'/'+p,sha256:sha(fs.readFileSync(root+'/'+p))});
}
fs.writeFileSync(out+'/prior-stop-pins.json',JSON.stringify(sealed,null,2));
for(const name of ['fixture-control.mjs','dev.mjs','seed-run.mjs','seed.ts','pg-run.mjs','common.mjs','overlay.mjs','stop-next.ps1']){
 let s=fs.readFileSync(old+'/'+name,'utf8').replaceAll('.tmp/1733-command-checks/runtime',out).replaceAll('<private-fixture-pointer-file>',out+'/runtime-pointer-private.txt').replaceAll('z8-1733-runtime-','z8-1733-final-runtime-').replaceAll('z8-1733-','z8-1733-final-');
 if(name==='common.mjs')s=s.replace('z8-1733-final-final-runtime-','z8-1733-final-runtime-');
 fs.writeFileSync(out+'/'+name,s);
}
let s=fs.readFileSync(old+'/preservation.mjs','utf8').replaceAll('.tmp/1733-command-checks/runtime',out).replaceAll('786ae5a9c81dd5b60d00d74f9a3534b45ed90242','166975f3c981d7f1f8d9e51bbce09fbe63b32568');
s=s.replace(" 'apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx',"," 'apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx',\n 'apps/webapp/src/components/personnel-file/use-payslip-batch-upload.ts',\n 'apps/webapp/src/components/personnel-file/use-payslip-batch-upload.browser.test.ts',");
fs.writeFileSync(out+'/preservation.mjs',s);
s=fs.readFileSync(old+'/controller.mjs','utf8');
s=s.replace("globalThis.db=new(h.req('pg').Client)({connectionString:h.r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();", "globalThis.gate=await import(h.repo+'/apps/webapp/src/test/integration-database.ts');await gate.verifySuiteDatabase();globalThis.db=gate.integrationAdminPool();globalThis.lockClient=await db.connect();");
s=s.replace("await db.query('ROLLBACK').catch(()=>{});await db.end();", "await lockClient.query('ROLLBACK').catch(()=>{});lockClient.release();await gate.closeIntegrationPools();");
s=s.replace("await import('./common.mjs')","await import('./common.mjs')");
fs.writeFileSync(out+'/controller.mjs',s);
let build=fs.readFileSync(old+'/build-probes.mjs','utf8').replaceAll('.tmp/1733-command-checks/runtime',out).replaceAll('independent1733v2','independent1733final');
fs.writeFileSync(out+'/build-probes.mjs',build);
let run=fs.readFileSync(old+'/run-probes.mjs','utf8').replaceAll('.tmp/1733-command-checks/runtime',out).replaceAll('independent1733v2','independent1733final');
fs.writeFileSync(out+'/run-probes.mjs',run);
for(const [pub,name]of [['command-probe.test.tsx','independent1733final-command-probe.test.tsx'],['heading-probe.test.tsx','independent1733final-heading-probe.test.tsx']]){
 const p='apps/webapp/src/components/personnel-file/'+name; if(fs.existsSync(p))throw Error('Existing bridge');
 const code=fs.readFileSync('.tmp/1733-command-checks/runtime/public/'+pub);fs.writeFileSync(out+'/'+pub,code);fs.writeFileSync(p,code);
}
fs.writeFileSync(out+'/bridge-ownership.json',JSON.stringify({files:['command','heading'].map(k=>({publicName:k+'-probe.test.tsx',path:'apps/webapp/src/components/personnel-file/independent1733final-'+k+'-probe.test.tsx'}))},null,2));
fs.writeFileSync(base+'/runtime-launch.mjs',`import{readFileSync,writeFileSync}from'node:fs';import{spawn}from'node:child_process';import{resolve,join}from'node:path';const out=resolve('${out}'),dir=readFileSync(join(out,'runtime-pointer-private.txt'),'utf8').trim(),r=JSON.parse(readFileSync(join(dir,'runtime-private.json'),'utf8')),args=['--config.verify-deps-before-run=false','exec','tsx',join(out,'controller.mjs')],c=spawn(process.env.npm_execpath,args,{cwd:resolve('apps/webapp'),env:{...process.env,...r.env,pnpm_config_verify_deps_before_run:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';for(const s of[c.stdout,c.stderr])s.on('data',b=>{log+=b;process.stdout.write(b)});c.on('exit',code=>{writeFileSync(join(dir,'controller-private.log'),log);process.exitCode=code??1;});`);
console.log('Fresh harness and exact owned public probe bridges prepared.');
