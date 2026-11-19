import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const[fixtureInput,cli]=process.argv.slice(2),repo=process.cwd(),dir=resolve(fixtureInput),out=resolve('docs/design/rollout-1692/1728');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(services.label,'z8-performance-fixture-1450');for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const session='next-dev-loop-1728-'+repo.split(/[/\\]/).at(-1);
const run=(args,input)=>new Promise(done=>{let stdout='',stderr='';const child=spawn(process.execPath,[cli,'--session',session,'--restore','--json',...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(input);child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);const timer=setTimeout(()=>child.kill(),45000);child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();done({code,out:stdout,err:stderr});});});
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
try{
 await save('native-open.json',await run(['--enable','react-devtools','open',r.origin+'/en/sign-in']));
 const actor=f.actors['small-admin'];
 const expression='(async()=>{const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 const auth=await run(['eval','--stdin'],expression);
 await writeFile(join(dir,'root-native-auth-diagnostics-private.json'),JSON.stringify(auth),{mode:0o600});
 let status;try{const parsed=JSON.parse(auth.out.trim());status=parsed.data?.result??parsed.data??parsed;}catch{}
 await save('native-auth-status.json',{code:auth.code,signIn:status?.signIn??null,active:status?.active??null});
 if(auth.code!==0||status?.signIn!==200||status?.active!==200)throw Error('Native fixture authentication failed; raw output remains private.');
 const target=r.origin+'/en/personnel-files';
 const opened=await run(['open',target]);await save('native-target-open.json',opened);
 assert.equal(opened.code,0);
 await save('native-wait.json',await run(['wait','--load','networkidle']));
 const tree=await run(['react','tree']);await save('native-tree.json',tree);
 assert.equal(tree.code,0);assert.match(tree.out,/PersonnelFilesWorkspace/);assert.match(tree.out,/ExpiringDocumentsCard/);
 const source=[];for(const path of ['apps/webapp/src/app/[locale]/(app)/personnel-files/page.tsx','apps/webapp/src/components/personnel-file/personnel-files-workspace.tsx','apps/webapp/src/components/personnel-file/expiring-documents.tsx'])source.push({path,canonicalSha256:createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex')});
 await save('native-source.json',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),session,source,targetWorkspacePresent:true,qualification:'Loaded employee workspace tree; not a native probe of the pending/scope-mismatch heading.'});
 console.log('Actual native target tree includes PersonnelFilesWorkspace and ExpiringDocumentsCard.');
}finally{await save('native-close.json',await run(['close']));}
