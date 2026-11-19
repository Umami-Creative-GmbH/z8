// Fixture-only identity variant; restore the exact original name in finally.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const a=fixture.actors['small-employee'],out=join(repo,'docs/design/rollout-1692/1719');
const {rows:[u]}=await pool.query('select u.id,u.name,u.first_name,u.last_name from "user" u join employee e on e.user_id=u.id where e.id=$1 and e.organization_id=$2',[a.employeeId,a.organizationId]);
const name='LongEmployeeIdentity'.repeat(12),evidence={observations:[],errors:[]};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 await pool.query('update "user" set name=$2,first_name=$2,last_name=$3 where id=$1',[u.id,name,'']);
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
 for(const width of [390,1600]){await page.setViewport({width,height:1000});await page.goto(new URL('/en/equipment/employees/'+a.employeeId,runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});await page.waitForFunction(name=>document.querySelector('h1')?.textContent.includes(name),{timeout:120000},name);await page.addStyleTag({content:'html{font-size:22.5px!important}'});await new Promise(resolve=>setTimeout(resolve,500));const result=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,headingWidth:document.querySelector('h1').getBoundingClientRect().width}));evidence.observations.push(result);assert.equal(result.width,width);await page.screenshot({path:join(out,'after-long-name-'+width+'.png'),fullPage:false});}
 assert.deepEqual(evidence.errors,[]);
}finally{await pool.query('update "user" set name=$2,first_name=$3,last_name=$4 where id=$1',[u.id,u.name,u.first_name,u.last_name]);await writeFile(join(out,'long-name.json'),JSON.stringify(evidence,null,2));await browser.close();await pool.end();}
