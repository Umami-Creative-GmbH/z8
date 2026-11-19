import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const {directory} = JSON.parse(readFileSync(new URL('./private-pointer.json', import.meta.url)));
const runtime = JSON.parse(readFileSync(join(directory, 'runtime-private.json')));
const fixture = JSON.parse(readFileSync(join(directory, 'fixture-private.json')));
if(fixture.kind !== 'disposable' || new URL(runtime.origin).hostname !== 'localhost') throw Error('Disposable loopback only');
const actor=fixture.actors[process.argv[2] || 'small-manager'];
const source=`(async()=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify(${JSON.stringify({email:actor.email,password:actor.password})})});if(!r.ok)throw Error('Fixture login failed');const a=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify(${JSON.stringify({organizationId:actor.organizationId})})});if(!a.ok)throw Error('Fixture activation failed');return {signedIn:true,active:true};})()`;
const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
// Only the script goes to private stdin; no cookies/session state are read, copied or saved.
const output=execFileSync(process.execPath,[cli,'--namespace','z8-1739','--session','z8-1739-final','eval','--stdin'],{input:source,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
if(!output.includes('signedIn')) throw Error('No login acknowledgement');
console.log('Generated fixture login and organization activation succeeded.');
