import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
const mode=process.argv[2],root=resolve('.'),app=resolve('apps/webapp'),out=resolve('.tmp/1835-root-checks');
const paths=['src/app/[locale]/onboarding/work-templates/actions.ts','src/app/[locale]/onboarding/work-templates/page-client.tsx','src/app/[locale]/onboarding/work-templates/page.test.tsx','src/app/[locale]/onboarding/work-templates/submission-arrival.test.tsx','src/app/[locale]/onboarding/work-templates/atomicity.integration.test.ts','src/lib/onboarding/work-template-mutation.ts','src/lib/effect/services/onboarding.service.ts','src/lib/user-preferences/user-settings-mutation.ts','src/lib/effect/services/onboarding.service.test.ts'];
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));let argv,cwd=app;
if(mode==='unit'){
 const original=await json('.tmp/merge1835-audit/unit.json'),selection=original.testResults.map(f=>relative(app,f.name).replaceAll('\\','/')).filter(p=>!p.startsWith('src/.merge1835-audit/'));
 selection.push('src/app/[locale]/onboarding/work-templates/submission-arrival.test.tsx','src/lib/user-preferences/user-settings-mutation.test.ts','src/lib/effect/services/database.service.test.ts','src/lib/effect/runtime-rule-guard.test.ts','src/lib/effect/services/database-error-sites.test.ts');
 for(const p of selection){assert.ok(p.startsWith('src/'));await readFile(join(app,p));}
 argv=['exec','vitest','run','--project','unit','--maxWorkers','2',...new Set(selection),'--reporter=json','--outputFile='+join(out,'unit.json')];
}else if(mode==='types')argv=['run','typecheck'];
else if(mode==='lint')argv=['exec','biome','check','--config-path=biome.jsonc','--formatter-enabled=false','--error-on-warnings',...paths];
else if(mode==='format')argv=['exec','biome','check','--config-path=biome.jsonc','--line-ending=crlf','--error-on-warnings',...paths.filter(p=>!p.endsWith('/onboarding.service.ts')&&!p.endsWith('/onboarding.service.test.ts'))];
else if(mode==='service-format')argv=['exec','biome','check','--config-path=biome.jsonc','--line-ending=crlf','src/lib/effect/services/onboarding.service.ts'];
else if(mode==='doctor'){cwd=root;argv=['exec','react-doctor','apps/webapp','--scope','changed','--base','90a7e5bdb34099bf9452e9462109cdf86429d164','--verbose','--no-score','--no-parallel','--no-telemetry','--no-supply-chain','--max-duration','90','--json','--json-out',join(out,'doctor.json')];}
else throw new Error('Unknown check');
argv.unshift('--config.verify-deps-before-run=false');assert.ok(process.env.npm_execpath);
const pins={};for(const p of paths)pins['apps/webapp/'+p]=createHash('sha256').update((await readFile(join(app,p),'utf8')).replaceAll('\r\n','\n')).digest('hex');
const started=new Date().toISOString(),child=spawnSync(process.env.npm_execpath,argv,{cwd,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
await writeFile(join(out,mode+'.log'),(child.stdout??'')+(child.stderr??''));
await writeFile(join(out,mode+'-command.json'),JSON.stringify({argv:['pnpm',...argv],cwd,started,ended:new Date().toISOString(),exitCode:child.status,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourcePins:pins},null,2)+'\n');
console.log(JSON.stringify({mode,exitCode:child.status,sourceFiles:paths.length}));process.exitCode=child.status??1;
