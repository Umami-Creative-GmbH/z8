import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const name=process.argv[2],out=resolve('.tmp/1736-root-checks'),read=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));
const paths=(await read('.tmp/1736-merger/format-valid-command.json')).argv.filter(x=>x.startsWith('src/'));paths.push('src/components/reports/projects/report-scope-failure.tsx','src/components/reports/projects/project-report-scope-recovery.test.tsx','src/lib/navigation/route-metadata.ts','src/lib/navigation/route-metadata.test.ts');let args;
if(name==='unit'||name==='public'){const c=await read('.tmp/1736-merger/'+(name==='unit'?'unit':'public-release')+'-command.json');args=c.argv.slice(1).map(x=>x.startsWith('--outputFile=')?'--outputFile='+resolve(out,name+'.json'):x);}
else if(name==='types')args=['--config.verify-deps-before-run=false','run','typecheck'];
else if(name==='format'||name==='lint')args=['--config.verify-deps-before-run=false','exec','biome','check','--config-path=./biome.jsonc','--line-ending=crlf','--line-width=100',...(name==='format'?['--write','--linter-enabled=false']:['--error-on-warnings']),...paths];
else if(name==='doctor')args=['--config.verify-deps-before-run=false','exec','react-doctor','apps/webapp','--scope','changed','--base','58ea18603a936d102f0625e3303f4c05689a9961','--verbose','--no-score','--no-parallel','--no-supply-chain','--no-telemetry','--max-duration','90','--json','--json-out',resolve(out,'doctor.json')];
else throw Error('Unknown check');
const pins={};for(const p of paths)pins['apps/webapp/'+p]=createHash('sha256').update((await readFile('apps/webapp/'+p,'utf8')).replaceAll('\r\n','\n')).digest('hex');
const binary=process.env.npm_execpath,native=binary.endsWith('.exe'),cwd=name==='doctor'?process.cwd():resolve('apps/webapp');const start=new Date().toISOString();
const r=spawnSync(native?binary:process.execPath,native?args:[binary,...args],{cwd,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024});
await writeFile(resolve(out,name+'.log'),(r.stdout??'')+(r.stderr??''));await writeFile(resolve(out,name+'-command.json'),JSON.stringify({argv:['pnpm',...args],cwd,exitCode:r.status,startedAt:start,finishedAt:new Date().toISOString(),sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourcePins:pins},null,2)+'\n');console.log(JSON.stringify({name,exitCode:r.status,sourceFiles:paths.length}));process.exitCode=r.status??1;
