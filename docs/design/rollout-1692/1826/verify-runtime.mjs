// pnpm node docs/design/rollout-1692/1826/verify-runtime.mjs <private-fixture> <before|after>
// Only synthetic, label-owned fixture services; never print credentials/cookies/OTP values.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory = resolve(process.argv[2]), phase = process.argv[3];
assert.ok(['before','after'].includes(phase));
const json = async name => JSON.parse(await readFile(join(directory,name),'utf8'));
const runtime = await json('runtime-private.json'), fixture = await json('fixture-private.json'), auth = await json('dev-auth-private.json'), services = await json('services.json');
assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const container of services.containers) assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require = createRequire(resolve('apps/webapp/package.json'));
const {Pool} = require('pg');
const pool = new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const actor = fixture.actors['small-admin'];
const person = (await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
if(phase==='before') await pool.query('INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES($1,true,0,$2) ON CONFLICT(organization_id) DO NOTHING',[actor.organizationId,person]);
// Restore the original synthetic enforced-window deadline after the lifecycle test's grace variant.
if(phase==='after') await pool.query('UPDATE organization_mfa_window SET deadline=starts_at,grace_period_days=0 WHERE organization_id=$1 AND user_id=$2',[actor.organizationId,person]);
const output = resolve('docs/design/rollout-1692/1826'); await mkdir(output,{recursive:true});
const sourceFiles=['apps/webapp/src/app/[locale]/mfa/page.tsx','apps/webapp/src/components/organization-mfa/requirements.tsx','apps/webapp/src/components/organization-mfa/verification.tsx','apps/webapp/src/components/organization-mfa/sign-out.tsx'];
const pin = async()=>({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),localAI:execFileSync('git',['rev-parse','ai/1692-app-wide-ui-refresh'],{encoding:'utf8'}).trim(),dirtyDiffSha256:createHash('sha256').update(execFileSync('git',['diff','--binary','HEAD'],{maxBuffer:40*1024*1024})).digest('hex'),files:Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])))});
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext(); await context.setCookie(...auth['small-admin'].cookies);
await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
const page=await context.newPage(); page.setDefaultTimeout(30000);
const results={phase,fixture:'disposable synthetic Performance small, small-admin, enforced MFA',source:await pin(),captures:[],checks:[]};
const check=(name,value)=>{assert.ok(value,name);results.checks.push({name,passed:true});console.log('Passed: '+name);};
try {
 await page.goto(`${runtime.origin}/en/mfa?organizationId=${actor.organizationId}&callbackUrl=%2Fen%2Fsettings%2Fsecurity`,{waitUntil:'networkidle0'});
 await page.waitForSelector('input[name="code"]');
 check('signed-in MFA has one main heading',await page.$$eval('h1',els=>els.length===1));
 check('authoritative organization and enforcement visible',await page.evaluate(()=>document.body.innerText.includes('Performance small')&&document.body.innerText.includes('An authenticator must be verified')));
 for(const [name,width,height,theme,font] of [['desktop-light',1600,1000,'light','default'],['phone-light',390,844,'light','default'],['wide-dark-large',2400,1200,'dark','large'],['phone-dark-large',390,844,'dark','large']]) {
  await page.setViewport({width,height});
  // Existing root providers read these actual saved preference values on reload.
  await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);
  await page.reload({waitUntil:'networkidle0'}); await page.waitForSelector('input[name="code"]'); await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({cssViewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')).fontSize,inputFont:getComputedStyle(document.querySelector('input')).fontSize,fontsStatus:document.fonts.status,theme:document.documentElement.className,fontPreference:localStorage.getItem('z8-font-size'),savedTheme:localStorage.getItem('theme'),devicePixelRatio,visualScale:visualViewport.scale}));
  const filename=`${phase}-${name}.png`; await page.screenshot({path:join(output,filename),fullPage:true});
  const png=await readFile(join(output,filename));
  results.captures.push({filename,source:await pin(),...metrics,pngDimensions:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}});
  if(phase==='after') check(`${name} fits document width and loads saved root preferences`,metrics.documentWidth===width&&metrics.fontsStatus==='loaded'&&metrics.theme.includes(theme)&&metrics.fontPreference===font);
 }
 if(phase==='after') {
  await page.type('input[name="code"]','123456');const input=await page.$('input[name="code"]');
  await page.setViewport({width:1600,height:1000});await page.setViewport({width:390,height:500});
  check('responsive resize retains the same mounted credential draft',await input.evaluate(el=>el===document.querySelector('input[name="code"]')&&el.value==='123456'));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.focus('input[name="code"]');await page.keyboard.press('Tab');
  check('native keyboard reaches primary verification after its code field',await page.evaluate(()=>document.activeElement.textContent.trim()==='Verify authenticator'));
  await page.$eval('nav',el=>el.scrollIntoView({block:'end'}));check('short phone retains reachable organization selection and sign-out',await page.$eval('nav',el=>el.getBoundingClientRect().bottom<=innerHeight+1));
  check('reduced-motion preference is honored by the browser',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 }
} finally { await writeFile(join(output,`${phase}-runtime.json`),JSON.stringify(results,null,2)); await browser.close(); await pool.end(); }
