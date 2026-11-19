import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {r,f,save,source,out,sha} from './common.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const session='z8-1728-correction-'+randomUUID().replaceAll('-',''),cli='C:/Users/KaiHentschel/AppData/Local/pnpm/bin/agent-browser.cmd';
const result={session,source:await source(),harnessSha256:sha(await readFile(join(out,'native.mjs'))),commands:[]};
const run=(args,input)=>new Promise((resolve,reject)=>{const quoted=[cli,'--session',session,'--restore-save','never','--json',...args].map(x=>'"'+x+'"').join(' ');const child=spawn(process.env.ComSpec??'cmd.exe',['/d','/s','/c','"'+quoted+'"'],{windowsHide:true,windowsVerbatimArguments:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdin.end(input);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);const timer=setTimeout(()=>child.kill(),55000);child.on('exit',code=>{clearTimeout(timer);resolve({code,out:stdout,err:stderr});});});
try{
 const opened=await run(['--enable','react-devtools','--args','--disable-notifications','open',r.origin+'/en/sign-in']);result.commands.push({name:'open',...opened});assert.equal(opened.code,0);
 const actor=f.actors['small-admin'],expression='(async()=>{const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!r.ok)return {signIn:r.status};const a=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return {signIn:r.status,active:a.status};})()';
 const auth=await run(['eval','--stdin'],expression);let status;try{const parsed=JSON.parse(auth.out.trim());status=parsed.data?.result??parsed.data??parsed;}catch{}result.auth={code:auth.code,signIn:status?.signIn,active:status?.active};assert.equal(result.auth.signIn,200);assert.equal(result.auth.active,200);
 const target=await run(['open',r.origin+'/en/personnel-files']);result.commands.push({name:'target',...target});assert.equal(target.code,0);
 result.commands.push({name:'wait',...await run(['wait','--fn',"window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0 && document.fonts.status === 'loaded'"])});
 const tree=await run(['react','tree']);result.commands.push({name:'tree',...tree});assert.equal(tree.code,0);assert.match(tree.out,/PersonnelFilesWorkspace/);assert.match(tree.out,/ExpiringDocumentsCard/);
 result.commands.push({name:'permission',...await run(['eval','--stdin'],'Notification.permission')});result.commands.push({name:'snapshot',...await run(['snapshot','-i'])});result.status='actual-target-tree-observed';
}catch(e){result.failure={name:e.name,message:e.message};process.exitCode=1;}finally{result.close=await run(['close']);await save('native-03.json',result);console.log(JSON.stringify({status:result.status??'failed',closed:result.close.code===0}));}
