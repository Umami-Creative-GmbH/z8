import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const repo=process.cwd(), app=join(repo,'apps/webapp');
const {directory}=JSON.parse(readFileSync(new URL('./private-pointer.json',import.meta.url)));
const runtime=JSON.parse(readFileSync(join(directory,'runtime-private.json')));
const [kind,...args]=process.argv.slice(2);
const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(k)));
const env={...environment,...runtime.env,pnpm_config_verify_deps_before_run:'false',CI:'true',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false',SKIP_ENV_VALIDATION:'0'};
let result;
if(kind==='integration'){
 result=spawnSync(process.env.npm_execpath,['--config.verify-deps-before-run=false','exec','vitest','run','--project','integration',...args],{cwd:app,env,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
}else if(kind==='licenses'){
 const base='C:/Users/KaiHentschel/AppData/Local/pnpm-cache/dlx/b9b04f882a6f74581e9c453de851f3a1/pkg/node_modules/license-report';
 const pkg=JSON.parse(readFileSync(join(base,'package.json')));if(pkg.version!=='6.8.6')throw Error('Exact cached license tool changed');
 const bin=typeof pkg.bin==='string'?pkg.bin:Object.values(pkg.bin)[0];
 result=spawnSync(process.execPath,[join(base,bin),'--only=prod','--output=json','--config','license-report-config.json'],{cwd:app,env,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
 if(result.status===0){JSON.parse(result.stdout);mkdirSync(join(app,'src/data'),{recursive:true});writeFileSync(join(app,'src/data/licenses.json'),result.stdout);}
}else if(kind==='build'){
 result=spawnSync(process.env.npm_execpath,['--config.verify-deps-before-run=false','exec','next','build','--experimental-build-mode','compile'],{cwd:app,env,encoding:'utf8',windowsHide:true,maxBuffer:30*1024*1024});
}else throw Error('Unknown check');
writeFileSync(resolve(`.tmp/1739-checks/${kind}.log`),(result.stderr??'')+(kind==='licenses'?'Generated own licenses artifact from exact cached 6.8.6.':result.stdout??''));
console.log(JSON.stringify({kind,status:result.status,error:result.error?.message}));process.exitCode=result.status??1;
