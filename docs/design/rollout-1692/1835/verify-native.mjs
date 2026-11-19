// Public CLI resolved from its installed shim; credentials go only through private stdin.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [fixtureInput,cli]=process.argv.slice(2),repo=process.cwd(),dir=resolve(fixtureInput),out=join(repo,'docs/design/rollout-1692/1835');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const session='next-dev-loop-1835-'+repo.split(/[/\\]/).at(-1);
const run=(args,input)=>new Promise(done=>{let stdout='',stderr='';const child=spawn(process.execPath,[cli,'--session',session,'--restore','--json',...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(input);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill(),45000);child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();done({code,out:stdout,err:stderr});});});
const save=async(n,v)=>writeFile(join(out,n),JSON.stringify(v,null,2)+'\n');
try {
 await save('native-version.json',await run(['--version']));
 await save('native-open.json',await run(['--enable','react-devtools','open',r.origin+'/en/sign-in']));
 const actor=f.actors['small-admin'];
 const expression='(async()=>{const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 const auth=await run(['eval','--stdin'],expression);await writeFile(join(dir,'native-auth-private.json'),JSON.stringify(auth),{mode:0o600});let status;try{const p=JSON.parse(auth.out);status=p.data?.result??p.data??p;}catch{}
 await save('native-auth-status.json',{code:auth.code,signIn:status?.signIn??null,active:status?.active??null});assert.equal(status?.signIn,200);assert.equal(status?.active,200);
 await save('native-target-open.json',await run(['open',r.origin+'/en/onboarding/work-templates']));await save('native-wait.json',await run(['wait','--load','networkidle']));
 const tree=await run(['react','tree']);await save('native-tree.json',tree);assert.equal(tree.code,0);assert.match(tree.out,/WorkTemplateSetup/);
 const decoded=JSON.parse(tree.out).data.tree;
 const match=decoded.match(/\d+\s+(\d+)\s+\d+\s+(?:Forget\()?WorkTemplateSetup/);assert.ok(match,'Actual target fiber ID');await save('native-inspect.json',await run(['react','inspect',match[1]]));
 const path='apps/webapp/src/app/[locale]/onboarding/work-templates/page-client.tsx',bytes=await readFile(path);await save('native-source.json',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),session,path,rawSha256:createHash('sha256').update(bytes).digest('hex'),lfSha256:createHash('sha256').update(bytes.toString().replaceAll('\r\n','\n')).digest('hex'),actualWorkTemplateSetupPresent:true});
 console.log('Native React tree includes the actual WorkTemplateSetup owner.');
}finally{await save('native-close.json',await run(['close']));}
