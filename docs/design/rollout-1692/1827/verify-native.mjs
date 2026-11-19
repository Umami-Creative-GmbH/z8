// Explicit checkout, guarded private fixture and installed agent-browser CLI. Native React != DOM evidence.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [repoInput,fixtureInput,cli]=process.argv.slice(2),repo=resolve(repoInput),fixture=resolve(fixtureInput);
const json=async p=>JSON.parse(await readFile(join(fixture,p),'utf8'));
const runtime=await json('runtime-private.json'),auth=await json('dev-auth-private.json'),data=await json('fixture-private.json');
assert.equal(data.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const state=join(fixture,'native-state-private.json');await writeFile(state,JSON.stringify({cookies:auth['small-admin'].cookies,origins:[]}),{mode:0o600});
const services=await json('services.json');assert.equal(services.label,'z8-performance-fixture-1450');for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const session='onboarding1827-native-fixture';const output=join(repo,'docs/design/rollout-1692/1827');
const run=(args,input)=>new Promise(resolve=>{let out='',err='';const child=spawn(process.execPath,[cli,'--session',session,...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(input);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const timer=setTimeout(()=>child.kill(),45000);child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();resolve({code,out,err});});});
try {
 const open=await run(['--enable','react-devtools','--state',state,'open',runtime.origin+'/en/onboarding/complete']);await writeFile(join(output,'native-second-open.json'),JSON.stringify(open,null,2));
 
 const actor=data.actors['small-admin'];
 const expression='(async()=>{ const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')}); if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 await writeFile(join(output,'native-auth-result.json'),JSON.stringify(await run(['eval','--stdin'],expression),null,2));
 await run(['open',runtime.origin+'/en/onboarding/complete']);
 await run(['wait','--load','networkidle']);
 const sourcePath='apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx';
 await writeFile(join(output,'native-source.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),blob:execFileSync('git',['hash-object','--path',sourcePath,sourcePath],{cwd:repo,encoding:'utf8'}).trim()},null,2));
 const tree=await run(['react','tree','--json']);await writeFile(join(output,'native-tree-result.json'),JSON.stringify(tree,null,2));
 console.log('Native tree response saved; usable target tree must be inspected separately.');
}finally {await writeFile(join(output,'native-final-close.json'),JSON.stringify(await run(['close']),null,2));}


