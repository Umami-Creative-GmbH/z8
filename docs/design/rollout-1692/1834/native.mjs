import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [fixtureInput,cli]=process.argv.slice(2),repo=process.cwd(),dir=resolve(fixtureInput),out=resolve('docs/design/rollout-1692/1834');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(services.containers.length,3);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const session='next-dev-loop-1834-'+repo.split(/[/\\]/).at(-1);
const run=(args,input)=>new Promise(done=>{let stdout='',stderr='';const child=spawn(process.execPath,[cli,'--session',session,'--restore','--json',...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(input);child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);const timer=setTimeout(()=>child.kill(),45000);child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();done({code,out:stdout,err:stderr});});});
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
try{
 await save('native-open.json',await run(['--enable','react-devtools','open',r.origin+'/en/sign-in']));
 const actor=f.actors['small-admin'];
 const expression='(async()=>{const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 const auth=await run(['eval','--stdin'],expression);
 await writeFile(join(dir,'native-auth-diagnostics-private.json'),JSON.stringify(auth),{mode:0o600});
 let status;try{const parsed=JSON.parse(auth.out.trim());status=parsed.data?.result??parsed.data??parsed;}catch{}
 await save('native-auth-status.json',{code:auth.code,signIn:status?.signIn??null,active:status?.active??null});
 assert.equal(status?.signIn,200);assert.equal(status?.active,200);
 await save('native-target-open.json',await run(['open',r.origin+'/en/onboarding/work-schedule']));
 await save('native-wait.json',await run(['wait','--load','networkidle']));
 const tree=await run(['react','tree']);await save('native-tree.json',tree);
 assert.equal(tree.code,0);assert.match(tree.out,/WorkScheduleForm/);assert.match(tree.out,/WorkScheduleHeading/);
 const call=async(method,params)=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('data: ')).slice(6)):JSON.parse(raw);};
 const listed=await call('tools/list');const diagnostics=[];for(const name of ['get_project_metadata','get_routes','get_compilation_issues','get_errors'])diagnostics.push({name,result:await call('tools/call',{name,arguments:{}})});
 await save('next-final.json',{listed,diagnostics});
 const source=[];for(const path of ['apps/webapp/src/app/[locale]/onboarding/work-schedule/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx'])source.push({path,canonicalSha256:createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex')});
 await save('native-source.json',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),session,source,targetTreePresent:true});
 console.log('Actual native WorkScheduleForm and WorkScheduleHeading tree verified.');
}finally{await save('native-close.json',await run(['close']));}
