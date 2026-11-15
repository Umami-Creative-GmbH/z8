import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const repo=process.cwd(), fixture=resolve(process.argv[2]), mode=process.argv[3];
const require=createRequire(join(repo,'package.json')), appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const puppeteer=require('puppeteer-core');
const runtime=JSON.parse(await readFile(join(fixture,'runtime-private.json'))), actors=JSON.parse(await readFile(join(fixture,'fixture-private.json'))), auth=JSON.parse(await readFile(join(fixture,'dev-auth-private.json')));
assert.equal(actors.kind,'disposable'); assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1'); assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const out=join(repo,'docs/design/rollout-1692/1723'); await mkdir(out,{recursive:true});
if(mode==='seed'||mode==='seed-reset'){
 const {Pool}=appRequire('pg'); const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD,database:runtime.env.POSTGRES_DB});
 try { for(const label of ['small-admin','small-manager','small-employee','small-restricted']){
 const a=actors.actors[label]; const result=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]); assert.equal(result.rows.length,1);
 if(mode==='seed-reset') await pool.query("delete from notification where user_id=$1 and organization_id=$2 and message in ('Security update: review your workforce updates.','Schedule published: review your workforce updates.','Absence approved: review your workforce updates.','Earlier update: review your workforce updates.')",[result.rows[0].user_id,a.organizationId]);
 for(const [i,title] of ['Security update','Schedule published','Absence approved','Earlier update'].entries()) await pool.query("insert into notification(user_id,organization_id,type,title,message,action_url,is_read,created_at) values($1,$2,'password_changed',$3,$4,'/settings/security',$5,now()-($6::int * interval '1 day'))",[result.rows[0].user_id,a.organizationId, title,`${title}: review your workforce updates.`,i===2,i===0?0:i===1?1:4]);
 } console.log('Seeded four owned synthetic recipient timelines.'); } finally {await pool.end();} process.exit();
}
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={mode,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:{},captures:[],errors:[]};
for(const file of ['apps/webapp/src/components/notifications/notifications-inbox.tsx','apps/webapp/src/components/notifications/notification-item.tsx','apps/webapp/src/lib/navigation/route-metadata.ts']) report.sources[file]=createHash('sha256').update(await readFile(join(repo,file))).digest('hex');
try {
 const context=await browser.createBrowserContext(); await context.overridePermissions(runtime.origin,[]); await context.setCookie(...auth['small-admin'].cookies); const page=await context.newPage(); page.on('pageerror',e=>report.errors.push(e.message));
 for(const [label,width,height,theme,font] of [['desktop-light',1600,1000,'light','16'],['wide-dark',2400,1200,'dark','16'],['phone-light',390,844,'light','18'],['phone-dark',390,844,'dark','18']]){
 await page.setViewport({width,height}); await page.goto(new URL('/en/notifications',runtime.origin).href,{waitUntil:'networkidle0'});
 // Use the application's persisted theme/font storage owners; no data replacement.
 await page.evaluate(({theme,font})=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font==='18'?'large':'default');}, {theme,font}); await page.reload({waitUntil:'networkidle0'});
 await page.waitForSelector('input[aria-label="Search notifications"]'); await page.waitForFunction(()=>document.body.innerText.includes('Security update')); await page.evaluate(()=>document.fonts.ready);
 const metadata=await page.evaluate(()=>({css:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth},theme:document.documentElement.className,fontSize:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,fontsReady:document.fonts.status,headings:[...document.querySelectorAll('h1')].map(n=>n.textContent),titles:[...document.querySelectorAll('[aria-label^="Select "]')].map(n=>n.getAttribute('aria-label'))}));
 assert.equal(metadata.fontSize,font+'px'); assert.ok(metadata.theme.includes(theme)); assert.equal(metadata.css.documentWidth,width);
 const path=join(out,`${mode}-${label}.png`); await page.screenshot({path,fullPage:true}); const bytes=await readFile(path); report.captures.push({label,...metadata,png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},sha256:createHash('sha256').update(bytes).digest('hex')});
 }
} finally {await browser.close();await writeFile(join(out,`${mode}-captures.json`),JSON.stringify(report,null,2)+'\n');}
console.log(`${mode}: ${report.captures.length} matched captures; ${report.errors.length} page errors.`);
