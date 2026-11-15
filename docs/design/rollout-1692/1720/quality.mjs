import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const repo=process.cwd(),out=join(repo,'docs/design/rollout-1692/1720');
const files=['src/app/[locale]/(app)/my-documents/page.tsx',...['my-documents-list','my-documents-scope','my-documents-retry','my-documents.test','requested-documents','document-dialog','document-list','document-request-list','submit-document-request-dialog'].map(n=>`src/components/personnel-file/${n}.${n.endsWith('.test')?'tsx':'tsx'}`),'src/lib/navigation/route-metadata.ts','src/lib/navigation/route-metadata.test.ts'];
const prefix=['--filter','webapp','exec'];
const commands=[
 ['unit',[...prefix,'vitest','run','--project','unit','src/components/personnel-file','src/lib/personnel-file','src/lib/navigation/route-metadata.test.ts','src/components/ui/action-panel.test.tsx','src/components/ui/alert-dialog.test.tsx','src/components/ui/page-header.test.tsx','src/components/data-table-server/data-table-toolbar.test.tsx']],
 ['types',['--filter','webapp','typecheck']],
 ['biome-default',[...prefix,'biome','check',...files]],
 ['biome-crlf-default',[...prefix,'biome','check','--line-ending=crlf',...files]],
 ['biome-explicit',[...prefix,'biome','check','--config-path=biome.jsonc','--line-ending=lf',...files.filter(p=>!p.includes('/navigation/'))]],
 ['biome-explicit-crlf',[...prefix,'biome','check','--config-path=biome.jsonc','--line-ending=crlf',...files.filter(p=>p.includes('/navigation/'))]],
 ['biome-explicit-lint-import',[...prefix,'biome','check','--config-path=biome.jsonc','--formatter-enabled=false',...files]],
 ['doctor',['exec','react-doctor',...files.filter(p=>!p.includes('.test.')&&!p.includes('/navigation/')).map(p=>'apps/webapp/'+p),'--verbose','--no-supply-chain','--no-cache']],
];
const results=[];
for(const [name,args] of commands){let output='';const child=spawn(process.env.npm_execpath,args,{cwd:repo,env:{...process.env,pnpm_config_verify_deps_before_run:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);const exitCode=await new Promise(resolve=>child.on('exit',resolve));await writeFile(join(out,name+'.txt'),output);results.push({command:'pnpm '+args.map(s=>s.includes(' ')?JSON.stringify(s):s).join(' '),exitCode,log:name+'.txt'});await writeFile(join(out,'quality.json'),JSON.stringify({commands:results},null,2)+'\n');console.log(name+': exit '+exitCode);}
