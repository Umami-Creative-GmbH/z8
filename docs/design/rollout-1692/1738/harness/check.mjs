import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve('.'),app=join(root,'apps/webapp'),out=join(root,'docs/design/rollout-1692/1738/checks');await mkdir(out,{recursive:true});
const [label,...args]=process.argv.slice(2);if(!/^[a-z0-9-]+$/.test(label))throw Error('label');
const git=(...a)=>spawnSync('git',a,{encoding:'utf8',cwd:root,windowsHide:true}).stdout.trim();
const files=git('ls-files','apps/webapp/src/components/scheduling','apps/webapp/src/app/[locale]/(app)/scheduling','apps/webapp/src/lib/navigation/route-metadata.ts','apps/webapp/src/lib/navigation/route-metadata.test.ts','pnpm-lock.yaml','apps/webapp/next.config.ts','apps/webapp/package.json','package.json').split('\n');
const extra=git('ls-files','--others','--exclude-standard','apps/webapp/src').split('\n').filter(Boolean);
const hashes={};for(const f of [...new Set([...files,...extra])].sort())hashes[f]=createHash('sha256').update(await readFile(join(root,f))).digest('hex');
const hash=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');await writeFile(join(out,`source-${hash}.json`),JSON.stringify({head:git('rev-parse','HEAD'),diffSha256:createHash('sha256').update(git('diff','HEAD','--binary')).digest('hex'),hashes}));
const runtime=JSON.parse(await readFile('.tmp/1738/private/runtime-private.json','utf8'));
const env={...process.env,...runtime.env,pnpm_config_verify_deps_before_run:'false',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false',ENABLE_CRON_JOBS:'false',CI:'true'};
if(args[0]==='vitest')env.NODE_ENV='test';
const pnpm=process.env.npm_execpath;if(!pnpm)throw Error('Use guarded pnpm');
const started=new Date().toISOString();const r=spawnSync(pnpm,['--config.verify-deps-before-run=false','exec',...args],{cwd:app,env,windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024});
await writeFile(join(out,label+'.log'),(r.stdout??'')+(r.stderr??'')+(r.error?.message??''));
await writeFile(join(out,label+'.json'),JSON.stringify({started,finished:new Date().toISOString(),cwd:app,env:'generated disposable local runtime; CI=true pnpm_config_verify_deps_before_run=false',command:['pnpm','--config.verify-deps-before-run=false','exec',...args],exit:r.status,source:hash},null,2));
console.log(label, 'exit', r.status, 'source',hash);process.exitCode=r.status??1;


