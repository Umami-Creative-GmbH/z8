import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { cli, evaluate, commands } from './native.mjs';
const out=resolve('docs/design/rollout-1692/1739');
const changed=['apps/webapp/src/app/[locale]/(app)/team/page.tsx','apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const sourceFiles=[...changed,'apps/webapp/src/app/[locale]/(app)/team/team-directory.tsx','apps/webapp/src/app/[locale]/(app)/team/team-directory-records.tsx','apps/webapp/src/app/[locale]/(app)/team/team-directory-feedback.tsx'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const pins=()=>sourceFiles.filter(existsSync).map(path=>({path,sha256:hash(readFileSync(path))}));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const observations={head,source:pins(),fixture:'owned generated small-manager, four visible members; same fixture for paired captures',commands,captures:[],checks:[]};
const state=()=>evaluate(`({path:location.pathname+location.search,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),theme:document.documentElement.className,font:getComputedStyle(document.documentElement).fontSize,viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,links:[...document.querySelectorAll('main a[href*="/settings/employees/"]')].map(x=>({text:x.textContent,href:x.getAttribute('href')})),dialogs:[...document.querySelectorAll('[role="dialog"]')].map(x=>x.textContent)})`);
const ready=()=>cli('wait','--fn',`location.pathname.endsWith('/team') && document.querySelector('input[aria-label="Search team members"]') && !document.querySelector('[role="dialog"]')`);
const record=(name,value)=>{observations.checks.push({name,value,source:pins()});writeFileSync(`${out}/runtime.json`,JSON.stringify(observations,null,2));};
async function captures(stage){
 for(const [name,w,h,theme] of [['desktop',1600,1000,'light'],['phone',390,844,'light'],['wide-dark',2560,1200,'dark']]){
  cli('set','viewport',String(w),String(h));cli('set','media',theme);ready();
  const actual=state();
  cli('screenshot',`${out}/${stage}-${name}.png`);
  observations.captures.push({path:`${stage}-${name}.png`,state:actual,source:pins(),qualification:stage==='before'?'Three original consumer files temporarily substituted; other integration files unchanged.':'Current owned source at recorded hashes.'});
 }
 writeFileSync(`${out}/${stage}-snapshot.txt`,cli('snapshot','-i'));
}
try{
 const original=changed.map((path,i)=>({path,bytes:readFileSync(path),before:readFileSync(new URL(['./before-page.tsx','./before-team-members-list.tsx','./before-route-metadata.ts'][i],import.meta.url))}));
 try{
  for(const f of original)writeFileSync(f.path,f.before);
  cli('open','http://localhost:55845/en/team');ready();
  await captures('before');
 } finally { for(const f of original)writeFileSync(f.path,f.bytes); }
 cli('open','http://localhost:55845/en/team');ready();
 await captures('after');
 assert.equal(state().h1.length,1);record('single heading and scope',state());
 cli('set','viewport','390','844');cli('set','media','light');
 cli('find','role','radio','click','--name','Table view');
 cli('wait','--fn',`!!document.querySelector('table')`);
 record('phone table reachable and local overflow',state());
 cli('find','role','radio','click','--name','Card view');
 cli('find','role','textbox','fill','Person 3','--name','Search team members');
 assert.equal(state().links.length,1);record('search scoped record',state());
 cli('find','role','textbox','fill','missing-person','--name','Search team members');
 cli('wait','--text','No results found');
 assert.equal(state().links.length,0);
 cli('find','role','button','click','--name','Clear search');
 assert.equal(state().links.length,4);record('no match and clear recovery',state());
 evaluate(`document.querySelector('button[aria-label="All-time balance: No balance"]').click()`);
 cli('wait','--fn',`!!document.querySelector('[role="dialog"]') && !document.querySelector('[aria-label="Loading balance adjustments"]')`);
 record('real authorized history read',state());
 cli('screenshot',`${out}/history-phone.png`);
 cli('press','Escape');
 cli('wait','--fn',`!document.querySelector('[role="dialog"]') && !document.querySelector('[data-slot="dialog-overlay"]')`);
 record('history escape focus',evaluate(`({dialog:!!document.querySelector('[role="dialog"]'),focus:document.activeElement?.getAttribute('aria-label')})`));
 cli('find','role','switch','click','--name','Show former employees');
 cli('wait','--fn',`location.search==='?former=1'`);
 record('former URL action readback',state());
 cli('find','role','switch','click','--name','Show former employees');
 cli('wait','--fn',`location.search===''`);
 record('former URL return',state());
 record('accessibility',JSON.parse(cli('--json','a11y')));
 record('react tree',JSON.parse(cli('--json','react','tree')));
 observations.finished=true;
}catch(error){observations.failure={message:error.message,stack:error.stack};throw error;}
finally{writeFileSync(`${out}/runtime.json`,JSON.stringify(observations,null,2));}
