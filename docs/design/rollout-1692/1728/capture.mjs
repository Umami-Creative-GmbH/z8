import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir=resolve('.tmp/1728/fixture'),out=resolve('docs/design/rollout-1692/1728');
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),a=await read('dev-auth-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg'),puppeteer=createRequire(resolve('package.json'))('puppeteer-core');const db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const c=await b.createBrowserContext();await c.setCookie(...a['small-admin'].cookies);await c.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});const p=await c.newPage();p.setDefaultTimeout(30000);
const result={stage:'start',checks:[],captures:[],errors:[],source:[],head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};p.on('pageerror',e=>result.errors.push(e.message));
const go=async path=>p.goto(r.origin+'/en'+path,{waitUntil:'networkidle2',timeout:90000});
const click=async(text,selector='button')=>{const element=await p.waitForFunction((text,selector)=>[...document.querySelectorAll(selector)].find(e=>e.checkVisibility()&&(e.textContent.trim()===text||e.getAttribute('aria-label')===text)),{},text,selector);await element.click();};
const capture=async name=>{await p.evaluate(()=>document.fonts.ready);const path=join(out,'after-'+name+'.png');await p.screenshot({path,fullPage:true});result.captures.push({path,...await p.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fontStatus:document.fonts.status,h1:[...document.querySelectorAll('main h1')].map(e=>e.textContent.trim())}))});};
try{
for(const path of ['apps/webapp/src/app/[locale]/(app)/personnel-files/page.tsx','apps/webapp/src/components/personnel-file/personnel-files-workspace.tsx','apps/webapp/src/components/personnel-file/expiring-documents.tsx','apps/webapp/src/lib/navigation/route-metadata.ts']){const bytes=await readFile(path);result.source.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),canonicalSha256:createHash('sha256').update(bytes.toString().replaceAll('\r\n','\n')).digest('hex')});}
result.stage='captures';await go('/personnel-files');await p.waitForSelector('main nav[aria-labelledby]');
for(const [name,width,height,dark]of[['desktop-light',1600,1000,false],['wide-dark',2400,1200,true],['phone-light',390,844,false],['phone-dark-large',390,844,true]]){
await p.setViewport({width,height});await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);await p.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);if(name.includes('large'))await p.evaluate(()=>document.documentElement.style.fontSize='18px');await capture(name);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width);assert.equal(await p.$$eval('main h1',es=>es.length),1);
}
result.checks.push('Four matched viewport/theme/text captures; one main h1; no document overflow. Large comparison is explicit CSS emulation, not saved preference.');
await p.setViewport({width:1600,height:1000});await p.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.classList.remove('dark');});
}finally{await writeFile(join(out,'final-captures.json'),JSON.stringify(result,null,2));await db.end();await b.close();}