import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { readBrowserControlBinding, verifyBrowserControlBrowser, installBrowserControlCollector } from './browser-control-collector.mjs';
import { testBrowserMetadata } from './control-cancellation-test-fixtures.mjs';
import { teamAnnualModule, teamAnnualWorkers, nativePublicPaths } from './control-cancellation-evidence.mjs';
import { installTargetedPrefetchProfile, createTargetedPrefetchProfileJournal, createTargetedPrefetchWorkerWitness, completeTargetedPrefetchProfileEvidence, targetedPrefetchProfile, releaseTargetedPrefetchProfileEvidence, releaseTargetedPrefetchProfileSamples } from './fixture-browser.mjs';

function windowFixture(controller=null,store=new Map()) {
 const listeners=new Map(),workerListeners=new Map(),calls=[],receipts=[];
 const worker={controller,addEventListener(name,fn){workerListeners.set(name,fn);},removeEventListener(name){workerListeners.delete(name);}};
 const result=Promise.resolve('original');
 const target={document:{readyState:'loading'},location:{href:'https://fixture.test/en/analytics'},navigator:{serviceWorker:worker},
  fetch(...args){calls.push({receiver:this,args});return result;},addEventListener(name,fn){listeners.set(name,fn);}};
 class StorageFixture{getItem(key){return store.get(key)??null;}setItem(key,value){store.set(key,String(value));}removeItem(key){store.delete(key);}}
 target.Storage=StorageFixture;target.sessionStorage=new StorageFixture();target.crypto=webcrypto;
 target.window=target;target.top=target;
 const receive=value=>receipts.push(JSON.parse(value));
 target.__z8TargetedPrefetchReceiptV1=receive;
 return {target,worker,listeners,workerListeners,calls,receipts,result};
}
const policy={protocol:'targeted-prefetch-profile-v1',profileId:'same-origin-next-prefetch-no-cache-v1',contractSha256:'a'.repeat(64)};
const sourceEpoch='b'.repeat(64);

test('approved prefetch condition preserves native URL, delegate result, receiver and all option identities',()=>{
 const f=windowFixture(),input=new URL('https://fixture.test/en/analytics?_rsc=synthetic'),headers={RSC:'1','Next-Router-Prefetch':'1'},signal=new AbortController().signal;
 installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 const init={headers,signal,credentials:'same-origin'},receiver={};
 assert.equal(f.target.fetch.call(receiver,input,init),f.result);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].receiver,receiver);assert.equal(f.calls[0].args[0],input);
 assert.equal(f.calls[0].args[1].cache,'no-cache');assert.equal(f.calls[0].args[1].headers,headers);assert.equal(f.calls[0].args[1].signal,signal);
 assert.equal(Object.hasOwn(init,'cache'),false);
});

test('terminal handoff preserves departure when native pagehide delivery is lost',()=>{
 const journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}}),store=new Map();
 const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{if(JSON.parse(payload).event!=='pagehide')journal.receive(1,payload);};
 installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
 first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});first.listeners.get('pagehide')({persisted:false});
 const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);
 const capsule=installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');capsule.snapshot();journal.close();
 const value=journal.snapshot();assert.equal(completeTargetedPrefetchProfileEvidence(value),true,JSON.stringify(value));
 assert.equal(value.documents[0].departed,true);assert.equal(value.documents[0].selected,1);assert.equal(store.size,0);releaseTargetedPrefetchProfileEvidence(value);
});

test('late hidden-window counters are retained by the same bounded terminal handoff',()=>{
 for(const mode of ['fetch','overwrite','controller']){
  const store=new Map(),journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});let hidden=false;
  const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{if(!hidden)journal.receive(1,payload);};
  installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
  first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});hidden=true;first.listeners.get('pagehide')({persisted:false});
  if(mode==='fetch')first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});
  if(mode==='overwrite')first.target.fetch=()=>Promise.resolve('changed');
  if(mode==='controller'){first.worker.controller={scriptURL:'https://fixture.test/other.js',state:'activated'};first.workerListeners.get('controllerchange')();}
  const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);
  installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test').snapshot();journal.close();const value=journal.snapshot();
  assert.equal(completeTargetedPrefetchProfileEvidence(value),mode==='fetch',mode);
  if(mode==='fetch')assert.equal(value.documents[0].selected,2);
  if(mode==='overwrite')assert.ok(value.documents[0].overwritten>0);
  if(mode==='controller')assert.equal(value.documents[0].controllerState,'invalid');
  releaseTargetedPrefetchProfileEvidence(value);
 }
});

test('handoff missing, poison, unknown nonce, replay and contradictory or post-seal facts remain strict',()=>{
 for(const mode of ['missing','poison','unknown-nonce','wrong-epoch','replay','contradictory','post-seal','stale-malformed','exact-native-mirror']){
  const store=new Map(),native=[],journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});let hidden=false;
  const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{native.push(payload);if(!hidden)journal.receive(1,payload);};
  installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});
  hidden=true;first.listeners.get('pagehide')({persisted:false});const key=[...store.keys()][0],original=store.get(key),terminal=JSON.parse(original);
  if(mode==='missing')store.delete(key);
  if(mode==='poison')store.set(key,'PRIVATE_POISON_MUST_NOT_LEAK');
  if(mode==='unknown-nonce'){terminal.nonce=(terminal.nonce[0]==='a'?'b':'a')+terminal.nonce.slice(1);store.set(key,JSON.stringify(terminal));}
  if(mode==='wrong-epoch'){terminal.sourceEpoch='c'.repeat(64);store.set(key,JSON.stringify(terminal));}
  if(mode==='contradictory'){terminal.receipt.calls=0;terminal.receipt.selected=0;store.set(key,JSON.stringify(terminal));}
  const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);
  const current=installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
  if(mode==='replay')store.set(key,original);
  if(mode==='post-seal'){hidden=false;first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});}
  if(mode==='stale-malformed')journal.receive(1,JSON.stringify({...JSON.parse(native[1]),private:'PRIVATE_POISON_MUST_NOT_LEAK'}));
  if(mode==='exact-native-mirror')journal.receive(1,native.at(-1));
  current.snapshot();journal.close();const value=journal.snapshot();assert.equal(completeTargetedPrefetchProfileEvidence(value),mode==='exact-native-mirror',mode+':'+JSON.stringify(value));
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_POISON/);assert.equal(store.size,0);releaseTargetedPrefetchProfileEvidence(value);
 }
});

test('a later BFCache restore cannot erase a missing earlier terminal handoff',()=>{
 const store=new Map(),journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});
 const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{if(JSON.parse(payload).event!=='pagehide')journal.receive(1,payload);};
 const original=installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');first.listeners.get('pagehide')({persisted:true});store.clear();
 const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
 next.listeners.get('pagehide')({persisted:true});first.listeners.get('pageshow')({persisted:true});original.snapshot();journal.close();
 const value=journal.snapshot();assert.equal(completeTargetedPrefetchProfileEvidence(value),false);releaseTargetedPrefetchProfileEvidence(value);
});

for(const mode of ['binding-throw','same-nonce-malformed','same-nonce-contradictory'])test(`terminal commit cannot hide ${mode}`,()=>{
  const store=new Map(),journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});let hidden=false;
  const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{if(hidden){if(mode==='binding-throw')throw Error('PRIVATE_BINDING_FAILURE');}else journal.receive(1,payload);};
  installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});
  hidden=true;first.listeners.get('pagehide')({persisted:false});
  if(mode!=='binding-throw'){
   const key=[...store.keys()][0],stored=JSON.parse(store.get(key));
   if(mode==='same-nonce-malformed')store.set(key,JSON.stringify({nonce:stored.nonce,private:'PRIVATE_STORED_POISON'}));
   else{stored.receipt.calls=0;stored.receipt.selected=0;store.set(key,JSON.stringify(stored));}
   first.target.fetch('/en/analytics',{headers:{RSC:'1','Next-Router-Prefetch':'1'}});
  }
  const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);
  installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test').snapshot();journal.close();const value=journal.snapshot();
  assert.equal(completeTargetedPrefetchProfileEvidence(value),false,mode);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_/);releaseTargetedPrefetchProfileEvidence(value);
});

for(const event of ['controller','checkpoint'])test(`same-sequence native mirror rejects changed event ${event}`,()=>{
  const store=new Map(),native=[],journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});
  const first=windowFixture(null,store);first.target.__z8TargetedPrefetchReceiptV1=payload=>{native.push(payload);if(JSON.parse(payload).event!=='pagehide')journal.receive(1,payload);};
  installTargetedPrefetchProfile(first.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');first.listeners.get('pagehide')({persisted:false});
  const next=windowFixture(null,store);next.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(2,payload);const capsule=installTargetedPrefetchProfile(next.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
  const altered={...JSON.parse(native.at(-1)),event,...(event==='checkpoint'?{handoffState:'empty'}:{})};journal.receive(1,JSON.stringify(altered));capsule.snapshot();journal.close();
  const value=journal.snapshot();assert.equal(completeTargetedPrefetchProfileEvidence(value),false,event);releaseTargetedPrefetchProfileEvidence(value);
});

test('phase source epoch and per-document receipts fail closed without discounting prior errors',()=>{
 let bytes=0,records=0;
 const journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,
  reserve:n=>(bytes+=n,true),release:n=>{bytes-=n;},reserveRecords:n=>(records+=n,true),releaseRecords:n=>{records-=n;}});
 const f=windowFixture();f.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(7,payload);
 const capsule=installTargetedPrefetchProfile(f.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');
 capsule.snapshot();journal.close();
 assert.equal(completeTargetedPrefetchProfileEvidence(journal.snapshot(),targetedPrefetchProfile),true);
 const incomplete=structuredClone(journal.snapshot());delete incomplete.documents[0].checkpoint;
 assert.equal(completeTargetedPrefetchProfileEvidence(incomplete,targetedPrefetchProfile),false);
 assert.equal(records,1);assert.ok(bytes>0);
 const value=journal.snapshot();assert.equal(journal.snapshot(),value);const samples=[{browserControlEvidence:{targetedPrefetchProfile:value}},{browserControlEvidence:{targetedPrefetchProfile:value}}];
 releaseTargetedPrefetchProfileSamples(samples);assert.equal(samples.every(sample=>!Object.hasOwn(sample.browserControlEvidence,'targetedPrefetchProfile')),true);
 assert.equal(releaseTargetedPrefetchProfileEvidence(value),false);assert.equal(bytes,0);assert.equal(records,0);assert.throws(()=>journal.snapshot(),/released/);
});

test('ordinary API, status, action and foreign fetches pass unsupported shapes without false profile errors',()=>{
 const f=windowFixture();const capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 for(const [input,init] of [['/api/status',new Headers()],['/api/time-clock',{}],['https://foreign.test/read',new Request('https://foreign.test/read')],['/en/analytics',{method:'POST',headers:new Headers()}],['/en/analytics',{headers:{'Next-Action':'synthetic'}}]]){
  f.target.fetch(input,init);assert.equal(f.calls.at(-1).args[1],init);
 }
 assert.equal(capsule.snapshot().unsupported,0);assert.equal(f.calls.length,5);
});

test('uncertain potential prefetch shapes fail coverage without invoking getters or changing the original call',()=>{
 const f=windowFixture();const capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');let read=0;
 const getter={get headers(){read++;throw Error('private');}};
 for(const init of [getter,{headers:new Headers({RSC:'1','Next-Router-Prefetch':'1'})},{headers:{RSC:'1','Next-Router-Prefetch':'1'},cache:'default'}]){
  f.target.fetch('/en/analytics',init);assert.equal(f.calls.at(-1).args[1],init);
 }
 assert.equal(read,0);assert.equal(capsule.snapshot().unsupported,3);
});

test('inherited explicit cache is not silently overridden for an eligible prefetch',()=>{
 const f=windowFixture();const capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 Object.defineProperty(Object.prototype,'cache',{value:'reload',configurable:true});
 try{const init={headers:{RSC:'1','Next-Router-Prefetch':'1'}};f.target.fetch('/en/analytics',init);assert.equal(f.calls[0].args[1],init);assert.equal(capsule.snapshot().unsupported,1);}
 finally{delete Object.prototype.cache;}
});

test('inherited Fetch eligibility fields stay unknown without invoking prototype getters',()=>{
 for(const key of ['method','mode','headers']){
  const f=windowFixture(),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');let touched=0;
  Object.defineProperty(Object.prototype,key,{get(){touched++;return key==='method'?'POST':key==='mode'?'navigate':{RSC:'1','Next-Router-Prefetch':'1'};},configurable:true});
  try{
   const init=key==='headers'?{}:{headers:{RSC:'1','Next-Router-Prefetch':'1'}};
   f.target.fetch('/en/analytics',init);assert.equal(f.calls[0].args[1],init);assert.equal(capsule.snapshot().unsupported,1);assert.equal(touched,0);
  }finally{delete Object.prototype[key];}
 }
});

test('natural activated controller binds once; early controlled calls and replacement remain failures',()=>{
 const listeners=new Map(),controller={scriptURL:'https://fixture.test/sw.js',state:'activating',addEventListener:(name,fn)=>listeners.set(name,fn)};
 const f=windowFixture(controller),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 const init={headers:{RSC:'1','Next-Router-Prefetch':'1'}};
 f.target.fetch('/en/analytics',init);assert.equal(f.calls.at(-1).args[1],init);
 controller.state='activated';listeners.get('statechange')();f.target.fetch(new URL('https://fixture.test/en/analytics'),init);
 assert.equal(f.calls.at(-1).args[1].cache,'no-cache');assert.equal(capsule.snapshot().unsupported,1);
 f.worker.controller={scriptURL:controller.scriptURL,state:'activated'};f.workerListeners.get('controllerchange')();
 f.target.fetch('/en/analytics',init);assert.equal(f.calls.at(-1).args[1],init);assert.equal(capsule.snapshot().controllerState,'invalid');
});

test('controlled selection retains the tested native-URL producer boundary',()=>{
 const f=windowFixture({scriptURL:'https://fixture.test/sw.js',state:'activated'}),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 const init={headers:{RSC:'1','Next-Router-Prefetch':'1'}};f.target.fetch('/en/analytics',init);
 assert.equal(f.calls[0].args[1],init);assert.equal(capsule.snapshot().unsupported,1);
});

test('replacement of the first activating controller cannot be adopted as a new source epoch',()=>{
 const a={scriptURL:'https://fixture.test/sw.js',state:'activating',addEventListener(){}};
 const f=windowFixture(a),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 f.worker.controller={scriptURL:a.scriptURL,state:'activated'};f.workerListeners.get('controllerchange')();
 assert.equal(capsule.snapshot().controllerState,'invalid');
});

test('retained BFCache capsule records restoration and detects assignment or descriptor overwrite',()=>{
 const f=windowFixture(),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
 f.listeners.get('pagehide')({persisted:true});f.listeners.get('pageshow')({persisted:true});
 assert.equal(capsule.snapshot().restores,1);assert.equal(capsule.snapshot().overwritten,0);
 const replacement=()=>Promise.resolve('new');f.target.fetch=replacement;assert.equal(f.target.fetch,replacement);assert.ok(capsule.snapshot().overwritten>0);
 const g=windowFixture(),other=installTargetedPrefetchProfile(g.target,policy,sourceEpoch,'https://fixture.test');
 Object.defineProperty(g.target,'fetch',{value:replacement,configurable:true});assert.ok(other.snapshot().overwritten>0);
});

test('abort rejection and synchronous delegate errors keep the original identity and happen once',async()=>{
 for(const synchronous of [false,true]){
  const f=windowFixture(),error=Error('synthetic abort');let calls=0;const rejected=Promise.reject(error);rejected.catch(()=>{});
  f.target.fetch=()=>{calls++;if(synchronous)throw error;return rejected;};installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
  const init={headers:{RSC:'1','Next-Router-Prefetch':'1'},signal:new AbortController().signal};
  if(synchronous)assert.throws(()=>f.target.fetch(new URL('https://fixture.test/en/analytics'),init),e=>e===error);
  else{const result=f.target.fetch(new URL('https://fixture.test/en/analytics'),init);assert.equal(result,rejected);await assert.rejects(result,e=>e===error);}
  assert.equal(calls,1);
 }
});

test('native URL proxy and coercion override never invoke user code or gain target coverage',()=>{
 const f=windowFixture(),capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');let touched=0;
 const proxy=new Proxy(new URL('https://fixture.test/en/analytics'),{getPrototypeOf(){touched++;throw Error('private');}});
 const overridden=new URL('https://fixture.test/en/analytics');Object.defineProperty(overridden,'href',{get(){touched++;throw Error('private');}});
 const init={headers:{RSC:'1','Next-Router-Prefetch':'1'}};f.target.fetch(proxy,init);f.target.fetch(overridden,init);
 assert.equal(touched,0);assert.equal(capsule.snapshot().unsupported,2);assert.equal(f.calls[0].args[0],proxy);
});

test('child frames cannot issue main-document installation receipts or replace the active document',()=>{
 const f=windowFixture(),original=f.target.fetch;f.target.top={};
 assert.equal(installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test'),null);
 assert.equal(f.target.fetch,original);assert.equal(f.receipts.length,0);
});

test('receipt denial is transactional; wrong epochs, regressions and missing final installation are not accepted',()=>{
 let records=0;const denied=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:n=>n===131072,release:n=>assert.equal(n,131072),reserveRecords:n=>(records+=n,true),releaseRecords:n=>{records-=n;}});
 const f=windowFixture();f.target.__z8TargetedPrefetchReceiptV1=payload=>denied.receive(1,payload);
 installTargetedPrefetchProfile(f.target,targetedPrefetchProfile,sourceEpoch,'https://fixture.test');denied.close();
 assert.equal(records,0);assert.equal(denied.snapshot().overflow,1);assert.equal(completeTargetedPrefetchProfileEvidence(denied.snapshot()),false);
 denied.dispose();
 const bad=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:()=>true,release:()=>{},reserveRecords:()=>true,releaseRecords:()=>{}});
 const g=windowFixture();installTargetedPrefetchProfile(g.target,policy,sourceEpoch,'https://fixture.test');
 for(const receipt of g.receipts)bad.receive(1,JSON.stringify({...receipt,sourceEpoch:'c'.repeat(64)}));
 bad.close();assert.equal(completeTargetedPrefetchProfileEvidence(bad.snapshot()),false);
});

test('same registration/version idle stop and new execution target preserve positive owned-client witness',()=>{
 const witness=createTargetedPrefetchWorkerWitness({origin:'https://fixture.test',targetId:'owned-page'});
 witness.registration({registrations:[{registrationId:'r',scopeURL:'https://fixture.test/',isDeleted:false}]});
 for(const [runningStatus,targetId] of [['running','worker1'],['stopping','worker1'],['stopped',undefined],['starting','worker2'],['running','worker2']])
  witness.version({versions:[{versionId:'v',registrationId:'r',scriptURL:'https://fixture.test/sw.js',status:'activated',runningStatus,targetId,controlledClients:['owned-page']}]});
 assert.equal(witness.snapshot().complete,true);assert.equal(witness.snapshot().errors,0);
 for(const mode of ['version','deleted','unrelated','ambiguous']){
  const other=createTargetedPrefetchWorkerWitness({origin:'https://fixture.test',targetId:'owned-page'});
  other.registration({registrations:[{registrationId:'r',scopeURL:'https://fixture.test/',isDeleted:mode==='deleted'}]});
  other.version({versions:[{versionId:'v',registrationId:'r',scriptURL:'https://fixture.test/sw.js',status:'activated',runningStatus:'running',controlledClients:mode==='unrelated'?['other']:['owned-page']}]});
  if(mode==='version'||mode==='ambiguous')other.version({versions:[{versionId:'new',registrationId:'r',scriptURL:'https://fixture.test/sw.js',status:'activated',runningStatus:'running',controlledClients:['owned-page']}]});
  assert.equal(other.snapshot().complete,false,mode);
 }
});

async function qualifiedFileFixture() {
 const directory=await mkdtemp(join(tmpdir(),'z8-prefetch-profile-')),manifestPath=join(directory,'app/.next/required-server-files.json'),build='c'.repeat(40);
 await mkdir(dirname(manifestPath),{recursive:true});const hash=value=>createHash('sha256').update(value).digest('hex');
 const manifest=Buffer.from(JSON.stringify({config:{deploymentId:build,experimental:{cachedNavigations:true}}}));await writeFile(manifestPath,manifest);
 await mkdir(join(dirname(manifestPath),'server'));await writeFile(join(dirname(manifestPath),'server/server-reference-manifest.json'),JSON.stringify({node:{['40'+'a'.repeat(40)]:{filename:teamAnnualModule,exportedName:'getTeamPerformanceData',workers:Object.fromEntries(teamAnnualWorkers.map(name=>[name,{moduleId:1,async:true}]))}},edge:{}}));
 const files=[];for(const file of nativePublicPaths){const bytes=Buffer.from('synthetic source '+file);const path=join(directory,'app/public',file);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);files.push({file,bytes:bytes.length,sha256:hash(bytes),gitBlob:'e'.repeat(40)});}
 const metadata={...testBrowserMetadata(),compiledManifestSha256:hash(manifest),targetedPrefetchProfile,nativePublicSources:{protocol:'qualified-serving-worker-sources-v1',compiledBuild:build,compiledManifestSha256:hash(manifest),files}};
 const plan={runtime:{build,targetedPrefetchProfile,browserControl:metadata}};
 const nextRoot=dirname(createRequire(new URL('../../apps/webapp/package.json',import.meta.url)).resolve('next/package.json')),nextCopy=join(directory,'app/node_modules/next');
 await mkdir(nextCopy,{recursive:true});await writeFile(join(nextCopy,'package.json'),JSON.stringify({name:'next',version:'16.4.0'}));
 for(const file of ['dist/client/components/segment-cache/fetch.js','dist/esm/client/components/segment-cache/fetch.js','dist/client/components/router-reducer/fetch-server-response.js','dist/esm/client/components/router-reducer/fetch-server-response.js','dist/build/define-env.js']){await mkdir(dirname(join(nextCopy,file)),{recursive:true});await copyFile(join(nextRoot,file),join(nextCopy,file));}
 return {directory,manifestPath,plan};
}

test('file admission rejects a changed/missing producer and enabled testing fetch override',async()=>{
 for(const mode of ['changed','missing','testing-override']){
  const files=await qualifiedFileFixture();
  try{
   const producer=join(files.directory,'app/node_modules/next/dist/client/components/segment-cache/fetch.js');
   if(mode==='changed')await writeFile(producer,'changed producer');
   else if(mode==='missing')await rm(producer);
   else{const manifest=JSON.parse(await readFile(files.manifestPath,'utf8'));manifest.config.experimental.exposeTestingApiInProductionBuild=true;const bytes=Buffer.from(JSON.stringify(manifest));await writeFile(files.manifestPath,bytes);const hash=createHash('sha256').update(bytes).digest('hex');files.plan.runtime.browserControl.compiledManifestSha256=hash;files.plan.runtime.browserControl.nativePublicSources.compiledManifestSha256=hash;}
   await assert.rejects(readBrowserControlBinding({plan:files.plan,manifestPath:files.manifestPath}),/qualified serving source epoch/,mode);
  }finally{const path=resolve(files.directory),parent=resolve(tmpdir());assert.ok(path.startsWith(parent+sep)&&path!==parent);await rm(path,{recursive:true,force:true});}
 }
});

test('real file-qualified installer covers fresh/controlled documents and BFCache with one continuous owned CDP witness',async()=>{
 for(const mode of ['healthy','changed-version','lost-session','changed-source','changed-producer','failed-install']){
 const files=await qualifiedFileFixture(),origin='http://localhost:1234';
 try {
  const binding=await readBrowserControlBinding({plan:files.plan,manifestPath:files.manifestPath}),session=new EventEmitter(),calls=[];
  const browser=Object.assign(new EventEmitter(),{targets:()=>[],target:()=>({createCDPSession:async()=>({send:async()=>({revision:'@'+binding.browserRevision}),detach:async()=>{}})})});
  const context={id:'owned-context',browser:()=>browser,cookies:async()=>[]},store=new Map();let script,pageURL='about:blank',world=null,previous=null,ordinal=0;
  const installError=Error('synthetic installation failure');
  session.send=async(name,args)=>{calls.push(name);if(mode==='failed-install'&&name==='Runtime.addBinding')throw installError;if(name==='Target.getTargetInfo')return {targetInfo:{type:'page',targetId:'owned-page',browserContextId:context.id}};return {};};session.detach=async()=>{session.detached=true;};
  const emitWorker=(runningStatus='running',targetId='worker1')=>{
   session.emit('ServiceWorker.workerRegistrationUpdated',{registrations:[{registrationId:'registration',scopeURL:origin+'/',isDeleted:false}]});
   session.emit('ServiceWorker.workerVersionUpdated',{versions:[{versionId:'version',registrationId:'registration',scriptURL:origin+'/sw.js',status:'activated',runningStatus,targetId,controlledClients:['owned-page']}]});
  };
  const makeWorld=()=>{const fixture=windowFixture(ordinal===0?null:{scriptURL:origin+'/sw.js',state:'activated'},store);fixture.target.location.href=origin+'/en/analytics';fixture.worker.getRegistrations=async()=>[];
   const id=++ordinal;fixture.target.__z8TargetedPrefetchReceiptV1=payload=>session.emit('Runtime.bindingCalled',{name:'__z8TargetedPrefetchReceiptV1',executionContextId:id,payload});
   const value=createContext({...fixture.target,URL});runInContext('window=globalThis;top=globalThis;',value);runInContext(script,value);return {fixture,value,id};};
  const navigate=async url=>{if(world){world.fixture.listeners.get('pagehide')({persisted:true});previous=world;}pageURL=url;world=makeWorld();if(!world.fixture.worker.controller){world.fixture.worker.controller={scriptURL:origin+'/sw.js',state:'activated'};world.fixture.workerListeners.get('controllerchange')();}emitWorker();return 'navigation-result';};
  const page=Object.assign(new EventEmitter(),{url:()=>pageURL,createCDPSession:async()=>session,evaluateOnNewDocument:async value=>{assert.ok(calls.includes('Runtime.addBinding'));assert.ok(calls.includes('ServiceWorker.enable'));script=value;},goto:navigate,reload:()=>navigate(pageURL),goBack:async()=>{world.fixture.listeners.get('pagehide')({persisted:true});[world,previous]=[previous,world];world.fixture.listeners.get('pageshow')({persisted:true});return 'back-result';},evaluate:async fn=>runInContext(`(${fn.toString()})()`,world.value)});
  const verified=await verifyBrowserControlBrowser(browser,binding);
  const install=()=>installBrowserControlCollector({page,context,transport:{setControlCancellationObserver(proxy){proxy.installed();return ()=>0;}},origin,headers:{},contextId:'synthetic-context',browserRevision:binding.browserRevision,environmentBinding:verified,operatorFile:'run-baseline.mjs'});
  if(mode==='failed-install'){await assert.rejects(install(),e=>e===installError);assert.equal(session.detached,true);assert.equal(session.listenerCount('ServiceWorker.workerVersionUpdated'),0);assert.equal(session.listenerCount('Runtime.bindingCalled'),0);continue;}
  const observer=await install();
  assert.equal(await page.goto(origin+'/en/analytics'),'navigation-result');
  runInContext(`fetch(new URL('${origin}/en/analytics'),{headers:{RSC:'1','Next-Router-Prefetch':'1'}});`,world.value);
  assert.equal(world.fixture.calls[0].args[1].cache,'no-cache');
  await page.goto(origin+'/en/reports');emitWorker('stopped',undefined);emitWorker('running','worker2');assert.equal(await page.goBack(),'back-result');
  if(mode==='changed-version')session.emit('ServiceWorker.workerVersionUpdated',{versions:[{versionId:'replacement',registrationId:'registration',scriptURL:origin+'/sw.js',status:'activated',runningStatus:'running',controlledClients:['owned-page']}]});
  if(mode==='lost-session')session.detached=true;
  if(mode==='changed-source'){
   await writeFile(join(files.directory,'app/public/sw.js'),'changed source');
   await assert.rejects(page.goto(origin+'/en/analytics'),/source epoch changed/);
  }
  if(mode==='changed-producer'){
   await writeFile(join(files.directory,'app/node_modules/next/dist/client/components/segment-cache/fetch.js'),'changed producer');
   await assert.rejects(page.goto(origin+'/en/analytics'),/source epoch changed/);
  }
  await observer.close({deadlineMs:performance.now()+1000});const proof=observer.snapshot().targetedPrefetchProfile;
  assert.equal(proof.documents.length,2);assert.equal(proof.documents[0].restores,1);assert.equal(proof.workerVersion.complete,mode!=='changed-version');
  assert.equal(completeTargetedPrefetchProfileEvidence(proof),mode==='healthy',mode+':'+JSON.stringify(proof));
  assert.equal(session.listenerCount('ServiceWorker.workerVersionUpdated'),0);
  releaseTargetedPrefetchProfileSamples([{browserControlEvidence:{targetedPrefetchProfile:proof}}]);
  observer.releaseTargetedPrefetchProfile();assert.throws(()=>observer.snapshot(),/released/);
 } finally {
  const path=resolve(files.directory),parent=resolve(tmpdir());assert.ok(path.startsWith(parent+sep)&&path!==parent);await rm(path,{recursive:true,force:true});
 }
 }
});

test('closed receipt and fixed source envelopes fit without secret retention or quota expansion',()=>{
 const receipt={event:'controller',calls:1000000,selected:500000,passed:500000,unsupported:1000000,overwritten:1000000,errors:1000000,restores:1000000,installed:true,controllerState:'uncontrolled'};
 const terminal={version:1,nonce:'a'.repeat(32),sourceEpoch,sequence:1000000,stage:'terminal',intact:true,receipt};
 const maximum={...receipt,event:'checkpoint',sourceEpoch,documentNonce:'c'.repeat(32),sequence:1000000,handoffState:'consumed',handoff:terminal};
 assert.ok(JSON.stringify(terminal).length<=512);assert.ok(Buffer.byteLength(JSON.stringify(maximum))<=2048);
 assert.ok(12*2048+4096<=32768,'storage, JSON/CDP/public workviews plus fixed private controls');
 assert.ok(installTargetedPrefetchProfile.toString().length+2048<=16384,'source plus bounded serialized profile/origin/epoch arguments');
 let bytes=0,records=0;const journal=createTargetedPrefetchProfileJournal({profile:targetedPrefetchProfile,sourceEpoch,reserve:n=>(bytes+=n,true),release:n=>{bytes-=n;},reserveRecords:n=>(records+=n,true),releaseRecords:n=>{records-=n;}});
 for(let id=1;id<=129;id++){
  const f=windowFixture();f.target.__z8TargetedPrefetchReceiptV1=payload=>journal.receive(id,payload);const capsule=installTargetedPrefetchProfile(f.target,policy,sourceEpoch,'https://fixture.test');
  if(id<129)f.listeners.get('pagehide')({persisted:false});else capsule.snapshot();
 }
 journal.receive(1,JSON.stringify({private:'PRIVATE_BODY_MUST_NOT_SURVIVE'}));journal.close();
 const value=journal.snapshot();assert.equal(value.documents.length,128);assert.ok(value.overflow>0);assert.equal(completeTargetedPrefetchProfileEvidence(value),false);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_BODY/);
 assert.equal(records,128);assert.equal(bytes,4325376);
 releaseTargetedPrefetchProfileEvidence(value);assert.equal(bytes,0);assert.equal(records,0);
});
