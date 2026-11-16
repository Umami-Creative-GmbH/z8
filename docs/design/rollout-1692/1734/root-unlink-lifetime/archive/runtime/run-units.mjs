import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const name=process.argv[2]||'public-confirmed';
const selected=name.startsWith('public-')?['src/.tmp/1734-independent-checks/public.test.tsx']:[
 'src/components/personnel-file/sick-leave-unlink-lifetime.test.tsx',
 'src/components/personnel-file/sick-leave-overview.test.tsx',
 'src/components/personnel-file/payslip-batch-workspace-scope.test.tsx',
 'src/components/personnel-file/payslip-batches-loading.test.tsx',
 'src/components/personnel-file/payslip-batch-workspace.test.tsx',
];
const args=['--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1',...selected,'--reporter=json',`--outputFile=../../.tmp/1734-independent-checks/${name}.json`];
const r=spawnSync(process.env.npm_execpath,args,{env:{...process.env,pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
fs.writeFileSync(`.tmp/1734-independent-checks/${name}.log`,r.stdout+r.stderr);
fs.writeFileSync(`.tmp/1734-independent-checks/${name}-command.json`,JSON.stringify({command:'pnpm',args,status:r.status,error:r.error?.message,signal:r.signal},null,2)+'\n');
const report=JSON.parse(fs.readFileSync(`.tmp/1734-independent-checks/${name}.json`,'utf8'));
console.log(JSON.stringify({name,status:r.status,cases:report.numTotalTests,passed:report.numPassedTests,failed:report.numFailedTests,files:report.testResults.length,unhandledErrors:report.unhandledErrors??null}));
process.exitCode=r.status??1;
