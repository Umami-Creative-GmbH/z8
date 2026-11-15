// pnpm node <this-file> <explicit-checkout> <private-fixture> <before|after>
// Public output contains observations only; never credentials, cookies or session payloads.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]),dir=resolve(process.argv[3]),phase=process.argv[4];
assert.ok(['before','after'].includes(phase));
const require=createRequire(join(root,'package.json')),puppeteer=require('puppeteer-core');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.equal(new URL(r.origin).hostname,'localhost');
assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const output=join(root,'docs/design/rollout-1692/1828');await mkdir(output,{recursive:true});
const files=['apps/webapp/src/app/[locale]/onboarding/notifications/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/notifications/page.tsx','apps/webapp/src/app/[locale]/onboarding/notifications/actions.ts','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/hooks/use-push-notifications.ts','apps/webapp/src/app/[locale]/onboarding/glass-panels.css','apps/webapp/src/components/onboarding/progress-indicator.tsx','apps/webapp/next.config.ts'];
const pin=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),localAI:execFileSync('git',['rev-parse','ai/1692-app-wide-ui-refresh'],{cwd:root,encoding:'utf8'}).trim(),files:Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')])))});
const results={phase,fixture:'synthetic disposable Performance small; small-admin',source:await pin(),captures:[],checks:[],errors:[]};
const check=(name,value)=>{assert.ok(value,name);results.checks.push({name,passed:true});console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext(),auth=await json('dev-auth-private.json');await context.setCookie(...auth['small-admin'].cookies);
await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});
const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>results.errors.push(e.message));
try{
 await page.goto(r.origin+'/en/onboarding/notifications',{waitUntil:'networkidle0'});await page.waitForSelector('#notification-enable-email');
 for(const [name,width,height,theme,font] of [['desktop-light',1600,1000,'light','default'],['phone-light',390,844,'light','default'],['wide-dark-large',2400,1200,'dark','large'],['phone-dark-large',390,844,'dark','large']]){
  await page.setViewport({width,height});await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#notification-enable-email');await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,theme:document.documentElement.className,fontPreference:localStorage.getItem('z8-font-size'),visualScale:visualViewport.scale,permission:Notification.permission}));
  const filename=`${phase}-${name}.png`;await page.screenshot({path:join(output,filename),fullPage:true});const png=await readFile(join(output,filename));results.captures.push({filename,source:await pin(),...metrics,pngDimensions:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}});
  if(phase==='after'){
   const contrast=await page.evaluate(()=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=1;canvas.height=1;
    const rgba=css=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
    const over=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]));
    const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('main h1,main h2,main p,main label')].filter(el=>el.checkVisibility()).map(el=>{
     const ancestors=[];for(let n=el;n;n=n.parentElement)ancestors.unshift(n);
     let bg=[255,255,255],opaque=false;for(const n of ancestors){const c=rgba(getComputedStyle(n).backgroundColor);if(c[3]===1)opaque=true;bg=over(c,bg);}
     const style=getComputedStyle(el),fg=over(rgba(style.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
     const minimum=parseFloat(style.fontSize)>=24 || parseFloat(style.fontSize)>=18.666 && parseInt(style.fontWeight)>=700 ? 3 : 4.5;
     return {tag:el.tagName,id:el.id,ratio,minimum,opaqueBackground:opaque,passed:opaque&&ratio>=minimum};
    });
   });
   results.captures.at(-1).contrast=contrast;check(name+' rendered text contrast on opaque surfaces',contrast.length>10&&contrast.every(x=>x.passed));
  }
  if(phase==='after')check(name+' fits width, uses saved preferences and actual denied permission',metrics.documentWidth===width&&metrics.theme.includes(theme)&&metrics.fonts==='loaded'&&metrics.permission==='denied');
 }
 if(phase==='after'){
  check('denied browser permission has truthful blocked context',await page.evaluate(()=>document.body.innerText.includes('Permission blocked')));
  await page.focus('#notification-enable-email');await page.keyboard.press('Tab');check('keyboard advances to topic switch',await page.evaluate(()=>document.activeElement.id==='notification-approvals'));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);check('reduced motion remains available',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 }
}catch(error){results.failure=error.message;throw error;}finally{await writeFile(join(output,`${phase}-runtime.json`),JSON.stringify(results,null,2)+'\n');await browser.close();}
