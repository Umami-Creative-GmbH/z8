import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {repo,route,heading,sourceProof,fixtureFromPointer,actionsForRoute,outputDir,save,failure} from './common.mjs';
// Run from repo: node <native.mjs> <pointer-path> <agent-browser-cli-js-path> <unique-output-dir>
const[pointer,cli,output]=process.argv.slice(2),out=await outputDir(output);
const session='next-dev-loop-1834-'+randomUUID(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));env.AGENT_BROWSER_SESSION=session;
const result={status:'failed-setup',setupComplete:false,session,checks:[],qualification:'Unique transient native session, normal private-stdin sign-in. No saved/transferred/restored cookies or browser state. Actual checkIsAdmin HTTP200 Response delayed after transport by disclosed fetch wrapper; original Response released unchanged after inspecting WorkScheduleLoading and WorkScheduleHeading.'};
let setup=false,failed=false,opened=false;
const run=(args,input)=>new Promise((resolve,reject)=>{
 let output='',error='',timedOut=false;
 const child=spawn(process.execPath,[cli,'--session',session,'--json',...args],{cwd:repo,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdin.end(input);child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>error+=buffer);
 const timer=setTimeout(()=>{timedOut=true;child.kill();},45000);
 child.on('error',error=>{clearTimeout(timer);reject(error);});
 child.on('exit',code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();resolve({code,timedOut,out:output,err:error});});
});
const value=response=>{assert.equal(response.code,0,'Native CLI command failed');assert.equal(response.timedOut,false);const parsed=JSON.parse(response.out.trim());return parsed.data?.result??parsed.data??parsed;};
const command=async(name,args,input)=>{const response=await run(args,input);await save(out,name,response);value(response);return response;};
const check=(name,condition)=>{assert.ok(condition,name);result.checks.push(name);};
const release='(()=>{const gate=window.__rootWorkSchedule1834;if(!gate)return{released:0};gate.active=false;for(const resume of gate.resolvers)resume();window.fetch=gate.original;return{released:gate.resolvers.length};})()';
try{
 assert.ok(cli,'Expected agent-browser CLI JS path');result.source=await sourceProof('after');const{runtime:r,fixture:f}=await fixtureFromPointer(pointer),actor=f.actors['large-admin'];assert.ok(actor,'large-admin fixture missing');
 await command('native-open.json',['--enable','react-devtools','open',r.origin+'/en/sign-in']);opened=true;
 const expression='(async()=>{const first=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json","x-captcha-response":"XXXX.DUMMY.TOKEN.XXXX"},body:JSON.stringify('+JSON.stringify({email:actor.email,password:actor.password})+')});if(!first.ok)return{signIn:first.status};const second=await fetch("/api/auth/organization/set-active",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+JSON.stringify({organizationId:actor.organizationId})+')});return{signIn:first.status,active:second.status};})()';
 // Credentials travel only on stdin; neither expression nor raw authentication output is persisted.
 const status=value(await run(['eval','--stdin'],expression));result.auth={signIn:status.signIn,active:status.active};assert.deepEqual(result.auth,{signIn:200,active:200});await save(out,'native-auth-status.json',result.auth);
 await command('native-warm-target.json',['open',r.origin+route]);await command('native-warm-ready.json',['wait','--fn','Boolean(document.querySelector("#work-schedule-hours-per-week"))']);result.actions=await actionsForRoute();
 await command('native-entry.json',['open',r.origin+'/en/onboarding/profile']);await command('native-entry-ready.json',['wait','--fn','Boolean(document.querySelector("#profile-first-name"))']);
 const install='(()=>{const original=window.fetch.bind(window),gate={active:true,held:0,statuses:[],resolvers:[],original};window.__rootWorkSchedule1834=gate;window.fetch=async function(input,init){const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));const target=headers.get("next-action")==='+JSON.stringify(result.actions.checkIsAdmin)+';const response=await original(input,init);if(target&&gate.active){gate.held++;gate.statuses.push(response.status);await new Promise(resolve=>gate.resolvers.push(resolve));}return response;};return{installed:true};})()';
 await command('native-gate.json',['eval','--stdin'],install);setup=true;result.setupComplete=true;result.status='running';
 await command('native-target.json',['pushstate',r.origin+route]);await command('native-pending-wait.json',['wait','--fn','Boolean(window.__rootWorkSchedule1834?.held)&&Boolean(document.querySelector("main [role=status][aria-label=\"Checking work schedule access\"]"))&&!document.querySelector("#work-schedule-hours-per-week")']);
 const observed=value(await command('native-pending-observation.json',['eval','--stdin'],'(()=>({path:location.pathname,held:window.__rootWorkSchedule1834?.held,statuses:window.__rootWorkSchedule1834?.statuses,headings:[...document.querySelectorAll("main h1")].filter(element=>element.checkVisibility()).map(element=>element.textContent.trim()),workControls:document.querySelectorAll("#work-schedule-hours-per-week,#work-schedule-classification").length,editableInputs:[...document.querySelectorAll("main input:not([type=hidden]),main textarea,main [contenteditable=true]")].filter(element=>element.checkVisibility()&&!element.disabled&&!element.readOnly).length}))()'));
 check('Actual native HTTP200 admission response is held',observed.path===route&&observed.held>=1&&observed.statuses.length>=1&&observed.statuses.every(status=>status===200));check('Native pending owner retains one safe task heading',JSON.stringify(observed.headings)===JSON.stringify([heading]));check('Native pending owner exposes no editable work controls',observed.workControls===0&&observed.editableInputs===0);
 const tree=await command('native-tree.json',['react','tree']);check('Actual native owner tree includes loading and task heading',tree.out.includes('WorkScheduleLoading')&&tree.out.includes('WorkScheduleHeading'));
 await command('native-release.json',['eval','--stdin'],release);await command('native-admitted.json',['wait','--fn','Boolean(document.querySelector("#work-schedule-hours-per-week"))']);
 const ready=value(await command('native-ready-observation.json',['eval','--stdin'],'(()=>({path:location.pathname,headings:[...document.querySelectorAll("main h1")].filter(element=>element.checkVisibility()).map(element=>element.textContent.trim()),hours:Boolean(document.querySelector("#work-schedule-hours-per-week"))}))()'));
 check('Unchanged native response reveals ready form with one task heading',ready.path===route&&ready.hours&&JSON.stringify(ready.headings)===JSON.stringify([heading]));result.sourceAtEnd=await sourceProof('after');assert.deepEqual(result.source.source,result.sourceAtEnd.source);result.status='accepted';
}catch(error){failed=true;result.status=setup?'failed-run':'failed-setup';result.failure=failure(error);}
finally{
 if(opened){await run(['eval','--stdin'],release).catch(()=>{});try{const closed=await command('native-close.json',['close']);if(closed.code!==0)throw new Error('Native cleanup failed');}catch(error){failed=true;result.status='failed-cleanup';result.cleanupFailure=failure(error);}}
 await save(out,'native-result.json',result);
}
console.log(JSON.stringify({status:result.status,checks:result.checks.length,session}));if(failed)process.exitCode=1;
