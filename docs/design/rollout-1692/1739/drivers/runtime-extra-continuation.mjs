import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cli,evaluate,commands} from './native.mjs';
import assert from 'node:assert/strict';
const out='docs/design/rollout-1692/1739';
const report=JSON.parse(readFileSync(`${out}/runtime-extra.json`));
delete report.failure;report.continuation='Pagination continued by native keyboard after developer issue badge obscured pointer target. Failed attempt retained separately.';
const inspect=()=>evaluate(`({path:location.pathname,font:getComputedStyle(document.documentElement).fontSize,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),links:[...document.querySelectorAll('main a[href*="/settings/employees/"]')].map(x=>x.textContent),text:document.querySelector('main')?.innerText})`);
const record=(name,value)=>{report.checks.push({name,value});writeFileSync(`${out}/runtime-extra.json`,JSON.stringify(report,null,2));};
function login(actor){execFileSync(process.execPath,['.tmp/1739-checks/login.mjs',actor],{stdio:['ignore','pipe','pipe'],windowsHide:true});}
function open(){cli('open','http://localhost:55845/en/team');cli('wait','--fn',`!!document.querySelector('input[aria-label="Search team members"]')`);if(cli('snapshot','-i').includes('button "Not Now"')){cli('find','role','button','click','--name','Not Now');cli('wait','--fn',`!document.querySelector('[role="dialog"]')`);}}
try{
 const first=inspect();evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Next').focus()`);
 cli('press','Enter');
 const second=inspect();assert.notDeepEqual(first.links,second.links);
 record('large manager paging with native Enter',{first,second});
 login('small-admin');open();record('admin retains original self plus managed relationship scope',inspect());assert.equal(inspect().links.length,1);
 login('small-restricted');cli('open','http://localhost:55845/en/team');cli('wait','--fn',`!location.pathname.endsWith('/team')`);record('actual custom employee role redirect',inspect());
 login('small-manager');open();report.finished=true;
}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}
finally{report.commands.push(...commands);writeFileSync(`${out}/runtime-extra.json`,JSON.stringify(report,null,2));}
