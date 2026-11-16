import {spawnSync,execFileSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {r,out,save,source} from './common.mjs';
const files=['document-request-officer','document-request-bulk','document-request-review','document-request-skill-link','document-requests','officer-grants'].map(n=>'src/lib/personnel-file/'+n+'.integration.test.ts');
const args=['--config.verify-deps-before-run=false','--dir','apps/webapp','exec','vitest','run','--project','integration','--maxWorkers','1',...files,'--reporter=json','--outputFile='+join(out,'postgres.json')];
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(k)));
const start=new Date().toISOString(),fd=openSync(join(out,'postgres-private.log'),'w');let result;try{result=spawnSync(process.env.npm_execpath,args,{cwd:process.cwd(),env:{...env,...r.env,pnpm_config_verify_deps_before_run:'false',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false'},windowsHide:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
await save('postgres-command.json',{literalCommand:'pnpm '+args.join(' '),args,start,end:new Date().toISOString(),source:await source(),exitCode:result.status});console.log('Six PostgreSQL suites exit '+result.status);process.exitCode=result.status??1;
