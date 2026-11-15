import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {repo,dir,runtime,fixture,pool} from '../1719/fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1831'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8')),a=fixture.actors['small-admin'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const result={scope:'second new owned fixture, small-admin / Performance small; no pre-existing policy',checks:[]};
const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);result.checks.push({name,actual});};
try{const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);const p=await context.newPage();await p.setViewport({width:390,height:844});await p.goto(runtime.origin+'/en/onboarding/vacation-policy',{waitUntil:'networkidle2',timeout:120000});await p.waitForSelector('#vacation-policy-name');
await p.click('#vacation-policy-accrual-type');await p.waitForSelector('[role=option]');const options=await p.$$('[role=option]');for(const o of options)if((await o.evaluate(e=>e.textContent)).includes('Biweekly'))await o.click();await p.click('#vacation-policy-allow-carryover');await p.waitForFunction(()=>!document.querySelector('#vacation-policy-max-carryover'));
await p.screenshot({path:join(out,'after-biweekly-no-carryover-phone.png'),fullPage:true});
const user=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0].user_id;
check('new organization starts without policies',(await pool.query('select count(*)::int as n from vacation_allowance where organization_id=$1',[a.organizationId])).rows[0].n,0);
let saveAction;let saves=0;const transports=[];p.on('request',req=>{const id=req.headers()['next-action'];if(req.method()==='POST'&&id){saveAction??=id;if(id===saveAction)saves++;transports.push(id);}});
const lock=await pool.connect();await lock.query('begin');await lock.query('lock table vacation_allowance in access exclusive mode');
try{await p.evaluate(()=>document.querySelector('form').requestSubmit());await p.waitForFunction(()=>document.querySelector('form[aria-busy=true]'));await p.evaluate(()=>{document.querySelector('form').requestSubmit();[...document.querySelectorAll('button')].find(e=>e.textContent==='Skip for now')?.click();});await p.waitForFunction(()=>document.querySelector('form input').disabled);await lock.query('commit');}finally{await lock.query('rollback');lock.release();}
await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/work-templates'),{timeout:30000});check('one actual save action under duplicate native submit and skip',saves,1);result.allActionTransports=transports.length;
const saved=(await pool.query('select name,default_annual_days,accrual_type,allow_carryover,max_carryover_days,carryover_expiry_months,is_company_default,created_by from vacation_allowance where organization_id=$1',[a.organizationId])).rows;
check('one real biweekly policy inserted',saved.length,1);check('biweekly without carryover persisted',[saved[0].name,saved[0].default_annual_days,saved[0].accrual_type,saved[0].allow_carryover,saved[0].max_carryover_days,saved[0].carryover_expiry_months,saved[0].is_company_default,saved[0].created_by===user],['Standard','25','biweekly',false,'5',null,true,true]);
}finally{await writeFile(join(out,'biweekly.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
