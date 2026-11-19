import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
const [command,...args]=process.argv.slice(2);
const runtime=JSON.parse(await readFile('.tmp/1738/private/runtime-private.json','utf8'));
const env={...process.env,AGENT_BROWSER_SESSION:'scheduling-1738-20261116-a83e6a27'};delete env.AGENT_BROWSER_RESTORE;delete env.AGENT_BROWSER_STATE;
function run(a,input){const r=spawnSync(process.execPath,[cli,'--session',env.AGENT_BROWSER_SESSION,...a],{env,shell:false,windowsHide:true,encoding:'utf8',input,maxBuffer:4*1024*1024});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');if(r.status)process.exit(r.status);}
if(command==='login'){
 const fixture=JSON.parse(await readFile('.tmp/1738/private/fixture-private.json','utf8'));
 const actor=fixture.actors[args[0]];if(!actor||fixture.kind!=='disposable')throw Error('Only generated actor');
 run(['eval','--stdin'],`(async()=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:actor.email,password:actor.password})})});return {status:r.status,ok:r.ok};})()`);
}else if(command==='open')run(['--enable','react-devtools','open',runtime.origin+(args[0]||'/en/scheduling')]);
else run([command,...args]);

