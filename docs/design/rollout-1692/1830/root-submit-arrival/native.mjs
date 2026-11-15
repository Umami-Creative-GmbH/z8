import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [input,cli]=process.argv.slice(2),dir=resolve(input),out=resolve('.tmp/1830-root-checks');
const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json');assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');
const session='next-dev-loop-1830-'+process.cwd().split(/[/\\]/).at(-1);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AGENT_BROWSER_')));env.AGENT_BROWSER_SESSION=session;
const run=(args,input)=>new Promise(done=>{let output='',error='';const child=spawn(process.execPath,[cli,'--session',session,'--json',...args],{cwd:process.cwd(),env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(input);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);const timer=setTimeout(()=>child.kill(),45000);child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();done({code,out:output,err:error});});});
const save=(n,v)=>writeFile(join(out,n),JSON.stringify(v,null,2)+'\n');
const value=r=>{const p=JSON.parse(r.out.trim());return p.data?.result??p.data??p;};
try {
 await save('native-open.json',await run(['--enable','react-devtools','open',r.origin+'/en/sign-in']));
 const actor=f.actors['small-admin'];
 const expression='(async()=>{const a=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!a.ok)return{signIn:a.status};const b=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return{signIn:a.status,active:b.status};})()';
 const auth=await run(['eval','--stdin'],expression);await writeFile(join(dir,'native-auth-diagnostics-private.json'),JSON.stringify(auth),{mode:0o600});const a=value(auth);await save('native-auth-status.json',{code:auth.code,signIn:a.signIn,active:a.active});assert.equal(a.signIn,200);assert.equal(a.active,200);
 await save('native-target-open.json',await run(['open',r.origin+'/en/onboarding/profile']));
 await save('native-target-wait.json',await run(['wait','--fn','Boolean(document.querySelector("#profile-first-name")) && !document.querySelector("button[type=submit]")?.disabled']));
 const tree=await run(['react','tree']);await save('native-tree.json',tree);assert.equal(tree.code,0);for(const n of ['ProfileStep','ProfileHeader','ProfileNameFields'])assert.ok(tree.out.includes(n),n);
 const path='apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx';await save('native-source.json',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),path,canonicalSha256:createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex'),session,qualification:'Fresh real loaded profile target. Private-stdin normal BetterAuth sign-in, no credential output, no cookie transfer or state/restore file. Transient documented no-restore session closes below. This does not retroactively pass the worker native attempt or reproduce queued-arrival timing.'});
 console.log('Actual native ProfileStep target tree inspected in a transient isolated session.');
} finally {await save('native-close.json',await run(['close']));}
