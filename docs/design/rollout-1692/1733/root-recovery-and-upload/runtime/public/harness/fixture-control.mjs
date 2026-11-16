import{spawnSync}from'node:child_process';import{readFileSync,writeFileSync,mkdtempSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import assert from'node:assert/strict';
const out=resolve('.tmp/1733-final-runtime-checks/runtime'),[kind,op]=process.argv.slice(2),pnpm=process.env.npm_execpath;assert.ok(['pg','runtime'].includes(kind));assert.ok(['prepare','cleanup'].includes(op));assert.ok(pnpm);
const pointer=join(out,kind+'-pointer-private.txt'),dir=op==='prepare'?mkdtempSync(join(tmpdir(),'z8-1733-final-'+kind+'-')):readFileSync(pointer,'utf8').trim();
if(op==='prepare')writeFileSync(pointer,dir,{mode:0o600});
const args=['--config.verify-deps-before-run=false','exec','node','scripts/performance/fixture.mjs',op,dir];
const r=spawnSync(pnpm,args,{encoding:'utf8',env:{...process.env,pnpm_config_verify_deps_before_run:'false'},windowsHide:true,maxBuffer:3e6});
writeFileSync(join(dir,op+'-private.log'),(r.stdout??'')+(r.stderr??''));
const safe={kind,operation:op,command:['pnpm',...args.slice(0,-1),'<owned-private-fixture>'],exit:r.status,spawnError:r.error?.code??null};
writeFileSync(join(out,kind+'-'+op+'.json'),JSON.stringify(safe,null,2)+'\n');console.log(JSON.stringify(safe));process.exitCode=r.status??1;
