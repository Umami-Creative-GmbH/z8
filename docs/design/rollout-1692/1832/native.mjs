// Private-stdin real login. Never imports/mints sessions or prints credential material.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const[repoArg,fixtureArg,cli,runName]=process.argv.slice(2),repo=resolve(repoArg),dir=resolve(fixtureArg);
const json=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(services.label,'z8-performance-fixture-1450');for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
assert.ok(!runName || /^[a-z0-9-]+$/.test(runName));const output=join(repo,'docs/design/rollout-1692/1832',runName||''),session='next-dev-loop-1832-'+repo.split(/[/\\]/).at(-1);
const run=(args,input)=>new Promise(done=>{let out='',err='';const p=spawn(process.execPath,[cli,'--session',session,...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdin.end(input);p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const timer=setTimeout(()=>p.kill(),45000);p.on('exit',code=>{clearTimeout(timer);p.stdout.destroy();p.stderr.destroy();done({code,out,err});});});
try{
 await writeFile(join(output,'native-open.json'),JSON.stringify(await run(['--enable','react-devtools','open',runtime.origin+'/en/sign-in']),null,2));
 const actor=fixture.actors['small-admin'];
 const expression='(async()=>{const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 const auth=await run(['eval','--stdin'],expression);await writeFile(join(output,'native-auth.json'),JSON.stringify(auth,null,2));assert.equal(auth.code,0);
 await run(['open',runtime.origin+'/en/onboarding/welcome']);await run(['wait','--load','networkidle']);
 const tree=await run(['react','tree','--json']);await writeFile(join(output,'native-tree.json'),JSON.stringify(tree,null,2));
 const p='apps/webapp/src/app/[locale]/onboarding/welcome/page-client.tsx';await writeFile(join(output,'native-source.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),blob:execFileSync('git',['hash-object','--path',p,p],{cwd:repo,encoding:'utf8'}).trim(),session},null,2));
 assert.equal(tree.code,0);assert.match(tree.out,/WelcomeArrival/);assert.match(tree.out,/WelcomeFrame/);console.log('Actual native target tree includes WelcomeArrival and WelcomeFrame.');
}finally{await writeFile(join(output,'native-close.json'),JSON.stringify(await run(['close']),null,2));}
