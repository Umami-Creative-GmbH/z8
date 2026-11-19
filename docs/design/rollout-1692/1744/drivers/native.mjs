import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const repo=process.cwd(),out=resolve('docs/design/rollout-1692/1744/native'),dir=resolve('.tmp/1744/fixture');await mkdir(out,{recursive:true});
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')),f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8')),p=JSON.parse(await readFile(join(dir,'presence-private.json'),'utf8'));
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');
const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
const session='next-dev-loop-1744-'+randomUUID(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));env.AGENT_BROWSER_SESSION=session;
const result={session,checks:[],qualification:'Unique transient native session; no restore/profile/state/cookie save or transfer. Normal development sign-in with fixture credentials on private stdin. --disable-notifications is launch policy, not permission grant. Viewport resize does not prove physical device or true zoom.'};
const run=(args,input)=>new Promise((done,reject)=>{const child=spawn(process.execPath,[cli,'--session',session,'--json',...args],{cwd:repo,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.stdin.end(input);const timer=setTimeout(()=>child.kill(),45000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);done({code,out,err})});});
const value=r=>{assert.equal(r.code,0,'Native browser command failed');const parsed=JSON.parse(r.out.trim());assert.notEqual(parsed.success,false);return parsed.data?.result??parsed.data??parsed;};
const command=async(name,args,input)=>{const r=await run(args,input);await writeFile(join(out,name+'.json'),JSON.stringify(r,null,2));return value(r)};
let opened=false;
try{
await command('open',['--executable-path','C:/Program Files/Google/Chrome/Application/chrome.exe','--args','--disable-notifications','--enable','react-devtools','open',r.origin+'/en/sign-in']);opened=true;
const a=f.actors['small-admin'];const code='(async()=>{const a='+JSON.stringify({email:a.email,password:a.password,organizationId:a.organizationId})+';const first=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify({email:a.email,password:a.password})});if(!first.ok)return[first.status];const second=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId:a.organizationId})});return[first.status,second.status]})()';
const auth=value(await run(['eval','--stdin'],code));assert.deepEqual(auth,[200,200]);result.auth=auth;
await command('target',['open',r.origin+'/en/team/presence/'+p.active]);await command('wait',['wait','--fn','Boolean(document.querySelector("main table"))&&document.querySelector("main table").textContent.includes("On break")']);
result.observed=await command('observed',['eval','--stdin'],'(()=>({headings:[...document.querySelectorAll("main h1")].filter(x=>x.checkVisibility()).map(x=>x.textContent.trim()),rows:[...document.querySelectorAll("main tbody tr")].map(x=>x.innerText),links:[...document.querySelectorAll("main tbody a")].map(x=>x.getAttribute("href")),permission:typeof Notification==="undefined"?"unavailable":Notification.permission}))()');assert.equal(result.observed.headings.length,1);assert.equal(result.observed.rows.length,2);assert.equal(result.observed.links.length,2);result.checks.push('Native normal sign-in and actual canonical roster with one page heading and employee links');
const tree=await command('tree',['react','tree']);const treeText=JSON.stringify(tree);assert.ok(treeText.includes('LocationPresenceList'));result.checks.push('Actual React tree includes LocationPresenceList');
await command('phone',['set','viewport','390','844']);await command('phone-screenshot',['screenshot',join(out,'phone.png')]);result.status='completed';
}catch(error){result.status='failed';result.failure={message:error.message,stack:error.stack};process.exitCode=1;}finally{if(opened)await command('close',['close']);await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({status:result.status,checks:result.checks.length}));
