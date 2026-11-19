// pnpm node .../capture.mjs <owned-fixture> <before|after>
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const repo=process.cwd(), dir=resolve(process.argv[2]),phase=process.argv[3],out=join(repo,'docs/design/rollout-1692/1824');
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')), seed=JSON.parse(await readFile(join(dir,'kiosk-private.json'),'utf8'));
if(!['before','after','before-final','after-final'].includes(phase)||!/^http:\/\/localhost:\d+$/.test(runtime.origin))throw Error('Owned local fixture required');
const sourceFiles=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','apps/webapp/src/components/kiosk','apps/webapp/src/lib/time-tracking/kiosk/kiosk-store.ts','apps/webapp/src/lib/time-tracking/kiosk/protocol.ts'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>!f.includes('.test.'));
const source=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(repo,file))).digest('hex')])));
const evidence={phase,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}),source,fixture:'ticket-owned disposable synthetic small organization',scope:'R025 Berlin workshop / R025 comparison kiosk / assigned Fixture Person 2',actor:'device without account session',views:[],errors:[]};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
const wait= text=>page.waitForFunction(text=>document.querySelector('main')?.innerText.includes(text),{timeout:120000},text);
const click=async text=>{const buttons=await page.$$('button');for(const b of buttons)if((await b.evaluate(n=>n.innerText.trim())).endsWith(text)){await b.click();return;}throw Error('Button missing: '+text);};
try{
 await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+'/en/kiosk',{waitUntil:'networkidle2',timeout:120000});await wait('Pair this device');
 await page.screenshot({path:join(out,phase+'-pairing.png'),fullPage:true});
 if(phase.startsWith('before') && !(await readFile(join(dir,'device-private.json'),'utf8').then(JSON.parse).catch(()=>null))){
  await page.type('input',seed.pairingCode);await click('Pair this device');await wait('R025 comparison kiosk');
  await writeFile(join(dir,'device-private.json'),JSON.stringify({token:await page.evaluate(()=>localStorage.getItem('z8.kiosk.deviceToken'))}),{mode:0o600});
 }else{
  const {token}=JSON.parse(await readFile(join(dir,'device-private.json'),'utf8'));
  await page.evaluate(token=>localStorage.setItem('z8.kiosk.deviceToken',token),token);await page.reload({waitUntil:'networkidle2'});
 }
 await wait('Fixture Person 2');
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['tablet-light',1024,768,false],['wide-dark',2400,1200,true]]){
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);
  await page.screenshot({path:join(out,`${phase}-${name}.png`),fullPage:true});
  evidence.views.push({name,...await page.evaluate(()=>({headings:[...document.querySelectorAll('main h1')].map(n=>n.textContent),width:document.documentElement.scrollWidth,viewport:innerWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,dark:document.documentElement.classList.contains('dark'),buttons:[...document.querySelectorAll('main button')].map(n=>({text:n.innerText,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))}))});
 }
 await page.setViewport({width:1600,height:1000});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);await click('Fixture Person 2');await wait('Enter your kiosk PIN');await page.screenshot({path:join(out,phase+'-pin.png'),fullPage:true});
 await writeFile(join(out,phase+'-captures.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({phase,views:evidence.views.length,errors:evidence.errors,head:evidence.head}));
}finally{await browser.close();}
