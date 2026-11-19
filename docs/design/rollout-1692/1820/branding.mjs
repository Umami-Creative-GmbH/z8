import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const repo=process.cwd(), dir=process.argv[2], out=join(repo,'docs/design/rollout-1692/1820');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),actors=await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const {Client}=createRequire(join(repo,'apps/webapp/package.json'))('pg');
const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const orgId=fixture.actors['small-admin'].organizationId;
const {rows:[org]}=await db.query('select slug,name from organization where id=$1',[orgId]);
await db.query('insert into organization_branding (organization_id,app_name,primary_color,updated_at) values ($1,$2,$3,now()) on conflict (organization_id) do update set app_name=excluded.app_name,primary_color=excluded.primary_color,updated_at=now()',[orgId,'Performance small','#2563eb']);
const browser=await createRequire(join(repo,'package.json'))('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--host-resolver-rules=MAP *.localhost [::1]']});
const cookie=actors['small-admin'].cookies.map(c=>`${c.name}=${c.value}`).join('; ');
const updateName=async name=>{const response=await fetch(new URL('/api/auth/organization/update',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Origin:runtime.origin,Cookie:cookie},body:JSON.stringify({organizationId:orgId,data:{name}})});assert.equal(response.status,200);};
const result=[], errors=[];
try {
 const context=await browser.createBrowserContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const invitation=await fetch(new URL('/api/auth/organization/invite-member',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Origin:runtime.origin,Cookie:cookie},body:JSON.stringify({organizationId:orgId,email:fixture.actors['large-restricted'].email,role:'member',resend:true})});assert.equal(invitation.status,200);const {id:valid}=await invitation.json();
 for(const [label,width,height,long] of [['branded-desktop',1600,1000,false],['branded-phone',390,844,false],['long-organization',390,844,true]]){
  if(long)await updateName('Performance small — Workforce operations for a multilingual organization with distributed teams and international offices across Europe');
  await page.setViewport({width,height});await page.goto(`http://${org.slug}.localhost:${runtime.port}/en/accept-invitation/${valid}`,{waitUntil:'networkidle0',timeout:90000});
  const state=await page.evaluate(()=>({heading:[...document.querySelectorAll('h1')].map(x=>x.textContent),brand:[...document.querySelectorAll('main p')].some(x=>x.textContent==='Performance small'),color:document.querySelector('main [style]')?.style.getPropertyValue('--primary'),text:document.querySelector('main')?.innerText,width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
  assert.ok(state.brand);assert.equal(state.color,'#2563eb');assert.equal(state.heading.length,1);assert.equal(state.documentWidth,width);result.push({label,...state});
  await page.screenshot({path:join(out,`after-${label}.png`),fullPage:true});
 }
 const focus=[];for(let n=0;n<12;n++){await page.keyboard.press('Tab');const item=await page.evaluate(()=>({name:document.activeElement?.tagName==='A'?document.activeElement.textContent.trim():'',shadow:getComputedStyle(document.activeElement).boxShadow}));if(item.name.includes('Create account')){assert.notEqual(item.shadow,'none');focus.push(item);await page.screenshot({path:join(out,'after-keyboard-focus.png'),fullPage:true});break;}}
 assert.equal(focus.length,1);result.push({label:'keyboard-visible-focus',focus});
 const loadingContext=await browser.createBrowserContext();const loading=await loadingContext.newPage();await loading.setViewport({width:390,height:844});
 await loading.setRequestInterception(true);let held;
 loading.on('request',request=>{if(request.url().includes('/api/auth/get-session'))held=request;else request.continue();});
 await loading.goto(`${runtime.origin}/en/accept-invitation/${valid}`,{waitUntil:'domcontentloaded'});
 await loading.waitForFunction(()=>document.querySelector('[role=status][aria-busy=true]')?.textContent.includes('Checking your invitation'));
 assert.equal(await loading.$$eval('main button',ns=>ns.length),0);await loading.screenshot({path:join(out,'after-session-loading.png'),fullPage:true});
 for(let n=0;n<30&&!held;n++)await new Promise(r=>setTimeout(r,100));assert.ok(held);await held.continue();
 await loading.waitForFunction(()=>document.body.innerText.includes('Invitation details'));result.push({label:'real-session-loading',busyAnnounced:true,actionsWithheldUntilResolved:true});await loadingContext.close();
}finally{await updateName(org.name);await browser.close();await db.end();await writeFile(join(out,'branding-runtime.json'),JSON.stringify({result,errors},null,2));}
assert.deepEqual(errors,[]);console.log('Verified actual stored name/color branding at desktop/phone and long organization reflow; zero page errors.');
