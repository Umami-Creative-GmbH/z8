import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cli,evaluate,commands} from './native.mjs';
import assert from 'node:assert/strict';
const out='docs/design/rollout-1692/1739';
const files=['page.tsx','team-directory.tsx','team-directory-records.tsx','team-directory-feedback.tsx','team-members-list.tsx'].map(x=>'apps/webapp/src/app/[locale]/(app)/team/'+x);
const report={source:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),checks:[],commands};
const record=(name,value)=>{report.checks.push({name,value});writeFileSync(`${out}/runtime-extra.json`,JSON.stringify(report,null,2));};
const inspect=()=>evaluate(`({path:location.pathname,search:document.querySelector('input[aria-label="Search team members"]')?.value,font:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className,viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),links:[...document.querySelectorAll('main a[href*="/settings/employees/"]')].map(x=>x.textContent),text:document.querySelector('main')?.innerText})`);
const open=()=>{cli('open','http://localhost:55845/en/team');cli('wait','--fn',`!!document.querySelector('input[aria-label="Search team members"]')`);if(evaluate(`[...document.querySelectorAll('button')].some(x=>x.textContent==='Not Now')`)){cli('find','role','button','click','--name','Not Now');cli('wait','--fn',`!document.querySelector('[role="dialog"]')`);}};
function login(actor){execFileSync(process.execPath,['.tmp/1739-checks/login.mjs',actor],{stdio:['ignore','pipe','pipe'],windowsHide:true});}
try{
 open();assert.equal(inspect().font,'18px');record('saved Large preference after reload',inspect());
 cli('set','viewport','390','844');cli('set','media','dark');
 cli('screenshot',`${out}/after-18px-phone-dark.png`);
 cli('find','role','radio','click','--name','Table view');
 cli('wait','--fn',`!!document.querySelector('table[data-mobile-layout="stacked"]')`);
 record('18px phone table all fields',inspect());
 cli('screenshot',`${out}/after-18px-phone-table.png`);
 assert.equal(inspect().pageWidth,390);
 cli('find','role','radio','click','--name','Card view');
 cli('set','viewport','1600','1000');
 cli('find','role','textbox','fill','Person 3','--name','Search team members');
 cli('find','role','button','click','--name','Toggle Sidebar');
 assert.equal(inspect().search,'Person 3');record('sidebar collapse retains search',inspect());
 cli('find','role','button','click','--name','Toggle Sidebar');
 cli('find','role','textbox','fill','','--name','Search team members');
 cli('find','role','link','click','--name','Person 3','--exact');
 cli('wait','--fn',`location.pathname.includes('/settings/employees/')`);
 record('existing authorized employee destination',inspect());
 open();
 cli('network','route','**/en/team','--abort');
 try{
  evaluate(`[...document.querySelectorAll('button[aria-label="All-time balance: No balance"]')][2].click()`);
  cli('wait','--text','The balance adjustments could not be loaded.');
  record('shared history failed-read public repro',evaluate(`({text:document.querySelector('[role="dialog"]')?.textContent,retry:[...document.querySelectorAll('[role="dialog"] button')].some(x=>/retry/i.test(x.textContent))})`));
  cli('screenshot',`${out}/history-failed-read.png`);
 }finally{cli('network','unroute','**/en/team');}
 cli('press','Escape');cli('wait','--fn',`!document.querySelector('[role="dialog"]')`);
 login('large-manager');open();cli('find','role','radio','click','--name','Table view');
 cli('wait','--fn',`!!document.querySelector('table')`);
 const first=inspect();cli('find','role','button','click','--name','Next','--exact');
 const second=inspect();assert.notDeepEqual(first.links,second.links);
 record('large manager pagination real scoped records',{first,second});
 login('small-admin');open();record('admin retains self plus managed-only action scope',inspect());
 assert.equal(inspect().links.length,1);
 login('small-restricted');cli('open','http://localhost:55845/en/team');cli('wait','--fn',`!location.pathname.endsWith('/team')`);
 record('custom employee role actual redirect',inspect());
 login('small-manager');open();report.finished=true;
}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}
finally{writeFileSync(`${out}/runtime-extra.json`,JSON.stringify(report,null,2));}
