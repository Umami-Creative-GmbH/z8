/** Candidate-only technical representation. Source owners reserve before constructing views. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {gzipSync,gunzipSync,constants} from 'node:zlib';
export const limits=Object.freeze({portable:4194304,logical:8388608,owner:33554432,records:10000,depth:64,header:48});
export const mixedTechnicalRepresentation=Object.freeze({protocol:'mixed-progress-technical-gzip-v1',kind:1,portableLimit:4194304,logicalLimit:8388608,retainedLimit:33554432,recordLimit:10000,owner:'existing-proxy-temporary-observation-owner-v1',accounting:'modeled-serialized-views-plus-explicit-buffers-v1'});
export const mixedTechnicalRuntime=Object.freeze({node:'26.9.0',zlib:'1.3.2.1-motley-285e94b'});
const states=new WeakMap(), leases=new WeakMap(), cutLeases=new WeakMap(), coverage=new WeakMap(), replayFacts=new WeakMap(), ownedCutViews=new WeakMap(), MAGIC='Z8MIXGZ2', CHUNK=65536;
const bad=()=>new Error('Mixed technical gzip rejected input.');
let captureObservation=null,representationObservation=null,reservationState=null;
const captureLabels=new Set(['original-provisional','canonical-traversal-and-scalar-scratch','canonical-key-vector','canonical-buffer','fixed-source-container-and-coverage-control','snapshot-clone','snapshot-typed-rows','sequential-row-constructor-scratch','snapshot-row-sort-index','snapshot-bounded-array','technical-predicate-fixed-shells','technical-predicate-return-view','derived-technical-receipt','immutable-snapshot-key-vectors','snapshot-UTF16-string','snapshot-UTF8-buffer','snapshot-fixed-constructor-shells','complete-progress-cut-clone-and-private-control']);
const diagnosticCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
for(const label of ['operation-hash-control-smallobjects','deflate-native-and-smallobjects','deflate-output-chunks','deflate-returned-buffer','portable-assembly','owned-native-subcut-borrow','candidate-replay-source-pin','candidate-subcut-view','bounded-json-replay-source-pin','bounded-json-replay-view-and-control'])captureLabels.add(label);
const representationStage=stage=>{if(representationObservation)representationObservation.stage=stage;};
function representationFailure(){try{const scope=representationObservation;if(scope&&!scope.failure)scope.failure=Object.freeze({protocol:'mixed-candidate-representation-failure-v1',stage:scope.stage,innerStage:scope.innerStage,ownerUsedBytes:scope.state?diagnosticCount(scope.state.used):null,ownerUsedRecords:scope.state?diagnosticCount(scope.state.records):null,refusal:scope.refusal});}catch{}}
// Synchronous, failure-only control slots. No graph/error is retained after this call.
export function observeMixedTechnicalCapture(construct,onFailure){
 const previous=captureObservation,scope={state:null,stage:null,innerStage:null,used:null,records:null,refusal:null,parent:null};captureObservation=scope;
 try{return construct();}catch(error){captureObservation=previous;try{onFailure(scope.state?Object.freeze({protocol:'mixed-input-capture-failure-v1',stage:scope.stage,innerStage:scope.innerStage,ownerUsedBytes:diagnosticCount(scope.used??scope.state.used),ownerUsedRecords:diagnosticCount(scope.records??scope.state.records),refusal:scope.refusal}):null);}catch{}throw error;}
 finally{captureObservation=previous;scope.state=null;scope.refusal=null;scope.parent=null;}
}
/** Called only on the original proxy reservation refusal; no additional reservation or getter. */
export function recordMixedTechnicalParentRefusal(usedBytes,usedRecords){const record=scope=>{try{if(scope?.state===reservationState&&!scope.parent)scope.parent=Object.freeze({parentUsedBytes:diagnosticCount(usedBytes),parentUsedRecords:diagnosticCount(usedRecords)});}catch{}};record(captureObservation);record(representationObservation);}
function captureRefusal(state,kind,label,bytes,records){const record=scope=>{try{if(scope?.state===state&&!scope.refusal)scope.refusal=Object.freeze({kind,label:captureLabels.has(label)?label:null,requestedBytes:diagnosticCount(bytes),requestedRecords:diagnosticCount(records),ownerUsedBytes:diagnosticCount(state.used),ownerUsedRecords:diagnosticCount(state.records),parentUsedBytes:scope.parent?.parentUsedBytes??null,parentUsedRecords:scope.parent?.parentUsedRecords??null});}catch{}};record(captureObservation);record(representationObservation);}
const must=x=>{if(!x)throw bad();};
const hash=b=>createHash('sha256').update(b).digest();
const round=n=>Math.ceil(n/CHUNK)*CHUNK;
// Root depth0 through depth64 can retain65 vectors simultaneously.
const vectorBase=65*10001*8+131072;
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const intrinsicGetter=(prototype,key)=>Object.getOwnPropertyDescriptor(prototype,key)?.get;
const getBuffer=intrinsicGetter(typedPrototype,'buffer'),getLength=intrinsicGetter(typedPrototype,'byteLength'),getOffset=intrinsicGetter(typedPrototype,'byteOffset');
const getBackingLength=intrinsicGetter(ArrayBuffer.prototype,'byteLength'),getResizable=intrinsicGetter(ArrayBuffer.prototype,'resizable'),getDetached=intrinsicGetter(ArrayBuffer.prototype,'detached');
const bufferPrototype=Buffer.prototype,apply=Reflect.apply,NativeUint8Array=Uint8Array,typedSet=Uint8Array.prototype.set;
const qualified=()=>{if(process.versions.node!==mixedTechnicalRuntime.node||process.versions.zlib!==mixedTechnicalRuntime.zlib||![getBuffer,getLength,getOffset,getBackingLength,getResizable,getDetached].every(value=>typeof value==='function'))throw Error('Mixed technical gzip requires qualified Node26.9.0/zlib1.3.2.1-motley-285e94b backing and strict-member APIs.');};
const ownData=(value,key)=>value&&typeof value==='object'&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
function bufferFacts(bytes){try{
 must(!types.isProxy(bytes)&&types.isUint8Array(bytes)&&Object.getPrototypeOf(bytes)===bufferPrototype);const backing=apply(getBuffer,bytes,[]);
 must(!types.isSharedArrayBuffer(backing)&&!apply(getResizable,backing,[])&&!apply(getDetached,backing,[]));
 const length=apply(getLength,bytes,[]),offset=apply(getOffset,bytes,[]),backingLength=apply(getBackingLength,backing,[]);must(length>0&&backingLength>0&&offset+length<=backingLength);
 return {backing,offset,length,backingLength};
 }catch{throw bad();}}

// Explicit modeled serialized views; buffers/UTF16/workspace charged separately.
// The adapter below uses the actual proxy callbacks. Constructor premises are
// listed in docs/performance/1450-clean-original-observation.md; no arbitrary graph entry is qualified.
function createBoundedOwner({reserve,release,reserveRecords,releaseRecords}){
 const state={used:0,peak:0,attempts:0,active:0,records:0,reserve,release,reserveRecords,releaseRecords};
  // Closed source constructor ONLY: every own-key width<=10001,
 // array length<=10000 and depth<=64 is known BEFORE entry. No eligibility flag.
 // Unknown arbitrary graphs must not invoke this constructor.
 const api=Object.freeze({holdSourceValue(value){
  const provisional=charge(state,limits.logical,'original-provisional');
  try{const m=measure(value,state);resize(provisional,m.bytes);bind(provisional,value);Object.assign(leases.get(provisional),{logicalBytes:m.bytes,logicalSHA:m.digest,typedRecords:m.typedRecords});return provisional;}catch{provisional.release();throw bad();}
 },holdPortable(bytes){const f=bufferFacts(bytes);must(f.length<=limits.portable);const lease=charge(state,f.backingLength,'portable-input');bind(lease,bytes);return lease;},snapshot:()=>Object.freeze({used:state.used,peak:state.peak,active:state.active,attempts:state.attempts,metric:'modeled-serialized-views-plus-explicit-buffer-string-workspace'})});
 states.set(api,state);return api;
}
function charge(state,bytes,label,records=0){
 if(representationObservation&&!representationObservation.state)representationObservation.state=state;
 const validBytes=Number.isSafeInteger(bytes)&&bytes>=0;if(!validBytes)captureRefusal(state,'invalid-byte-count',label,bytes,records);must(validBytes);state.attempts++;
 const allowed=Number.isSafeInteger(records)&&records>=0&&state.records+records<=limits.records&&state.used+bytes<=limits.owner;if(!allowed)captureRefusal(state,'owner-limit',label,bytes,records);must(allowed);
 if(records){let granted;const previous=reservationState;try{reservationState=state;granted=state.reserveRecords(records)===true;}catch(error){captureRefusal(state,'parent-records-threw',label,bytes,records);throw error;}finally{reservationState=previous;}if(!granted)captureRefusal(state,'parent-records-refused',label,bytes,records);must(granted);}
 let reserved=false;const previous=reservationState;try{reservationState=state;reserved=state.reserve(bytes)===true;}catch{captureRefusal(state,'parent-bytes-threw',label,bytes,records);if(records)state.releaseRecords(records);throw bad();}finally{reservationState=previous;}
 if(!reserved){captureRefusal(state,'parent-bytes-refused',label,bytes,records);if(records)state.releaseRecords(records);throw bad();}
 state.records+=records;
 state.used+=bytes;state.peak=Math.max(state.peak,state.used);state.active++;
 const lease=Object.freeze({release(){const s=leases.get(lease);if(s.live){s.onRelease?.();s.value=null;s.logicalSHA=null;s.live=false;state.used-=s.bytes;state.active--;state.records-=s.records;state.release(s.bytes);if(s.records)state.releaseRecords(s.records);}}});
 leases.set(lease,{state,bytes,records,label,live:true,value:null});return lease;
}
function bind(lease,value){leases.get(lease).value=value;}
function resize(lease,bytes){const s=leases.get(lease);must(s?.live&&bytes<=s.bytes);const difference=s.bytes-bytes;s.state.used-=difference;s.bytes=bytes;if(difference)s.state.release(difference);}
function owned(lease,value){must(lease&&typeof lease==='object'&&!types.isProxy(lease));const s=leases.get(lease);must(s?.live&&s.value===value);return s.state;}

// Bounded scalar chunks avoid a whole UTF16 JSON intermediate. Do not split pairs.
function stringTokens(text,emit){
 emit('"');
 for(let offset=0;offset<text.length;){let end=Math.min(offset+4096,text.length);if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff&&text.charCodeAt(end)>=0xdc00&&text.charCodeAt(end)<=0xdfff)end--;
  const quoted=JSON.stringify(text.slice(offset,end));emit(quoted.slice(1,-1));offset=end;
 }
 emit('"');
}
const typedCollections=Object.freeze({
 'owned-proxy-upstream-header-census-v1':['requests','faults'],'owned-proxy-upstream-header-cut-v1':['requests'],
 'actual-cdp-document-journal-v1':['executionEvents','documents'],'owned-context-worker-target-metadata-v1':['events'],
 'owned-read-only-principal-operations-v1':['pending','records'],'actual-team-source-read-journal-v1':['records'],
 'bounded-unqualified-team-values-v1':['rows'],'team-source-occurrence-journal-v1':['records'],'team-replay-dispatch-observations-v1':['rows'],
 'actual-body-value-observations-v1':['records'],'positive-flight-error-observations-v1':['records'],
 'actual-browser-failed-occurrence-census-v1':['records'],'mixed-native-progress-observations-v1':[],
 'serving-public-worker-source-metadata-v1':['files'],'qualified-serving-worker-sources-v1':['files'],'owned-native-launch-metadata-v1':['observerSources'],
});
function tokens(value,emit,projection=null,{state=null,incremental=false}={}){
 const ancestors=new Set();let slots=0,nodes=0,rootReceiptRows=0,typedRecords=0;
 function walk(v,depth){must(depth<=limits.depth&&++nodes<=1000000);
  if(v===null){emit('null');return;}if(typeof v==='string'){stringTokens(v,emit);return;}
  if(typeof v==='boolean'){emit(v?'true':'false');return;}
  if(typeof v==='number'){must(Number.isFinite(v)&&!Object.is(v,-0));emit(String(v));return;}
  must(v&&typeof v==='object'&&!types.isProxy(v)&&!ancestors.has(v));
  const array=Array.isArray(v);must(Object.getPrototypeOf(v)===(array?Array.prototype:Object.prototype));
  if(!array){
   const own=name=>Object.getOwnPropertyDescriptor(v,name)?.value,protocol=own('protocol');
   const fields=typeof protocol==='string'&&Object.hasOwn(typedCollections,protocol)?typedCollections[protocol]:[];
   for(const field of fields){const rows=own(field);must(!types.isProxy(rows)&&Array.isArray(rows));typedRecords+=rows.length;}
   const usedBodies=own('usedBodies');if(own('requestFacts')&&own('typeFacts')&&!types.isProxy(usedBodies)&&Array.isArray(usedBodies))typedRecords+=usedBodies.length;
   if(own('nativeContext')&&['failures','responses','proxy'].every(name=>!types.isProxy(own(name))&&Array.isArray(own(name))))for(const name of ['failures','responses','proxy'])typedRecords+=own(name).length;
   must(typedRecords<=limits.records);
  }
  if(array)must(v.length<=limits.records);
  let keys=null,vector=null;
  // The closed-source width ceiling is reserved before enumeration. Arrays use
  // the same ceiling here; no extra-own-key premise is inferred from length.
  try{if(incremental)vector=charge(state,10001*8,'canonical-key-vector');keys=Reflect.ownKeys(v);must(keys.length<=10001&&keys.every(k=>typeof k==='string'));if(vector)resize(vector,keys.length*8);
  if(!array){const protocol=Object.getOwnPropertyDescriptor(v,'protocol')?.value;
   if(protocol==='acknowledged-mixed-native-prefix-v1'||protocol==='mixed-first-failure-diagnostic-v1')typedRecords++;
   if(['actual-cdp-document-acknowledgment-v1','native-environment-progress-readonly-v1','native-environment-end-readonly-v1','owned-native-launch-metadata-v1'].includes(protocol))typedRecords++;
   if(protocol==='native-environment-progress-readonly-v1'||protocol==='native-environment-end-readonly-v1'){const controller=Object.getOwnPropertyDescriptor(v,'controller')?.value,rows=ownData(controller,'registrations');if(!types.isProxy(rows)&&Array.isArray(rows))typedRecords+=rows.length;}
   if(keys.length===5&&['ordinal','begin','returned','checkpointOrdinal','prefixSha256'].every(key=>Object.hasOwn(v,key)))typedRecords++;
   if(keys.length===4&&['ordinal','contextId','authoritySha256','failureIds'].every(key=>Object.hasOwn(v,key)))typedRecords++;
   if(keys.length===6&&(['frameId','loaderId','executionContextUniqueId','executionContextId','documentRequestId','documentGeneration'].every(key=>Object.hasOwn(v,key))||ownData(v,'kind')==='read-only-context-cookies-v1'))typedRecords++;
   must(typedRecords<=limits.records);
  }
  ancestors.add(v);emit(array?'[':'{');let count=0;
  if(array){must(keys.length===v.length+1&&keys.at(-1)==='length');slots+=v.length;}
  for(const key of keys){if(array&&key==='length')continue;if(depth===0&&projection&&(projection.keys&&!projection.keys.includes(key)||projection.omit?.includes(key)))continue;const d=Object.getOwnPropertyDescriptor(v,key);must(d&&Object.hasOwn(d,'value')&&d.enumerable);if(depth===0&&projection&&d.value===undefined)continue;
   if(depth===0&&['failures','responses','proxy'].includes(key)&&!types.isProxy(d.value)&&Array.isArray(d.value)){rootReceiptRows+=d.value.length;must(rootReceiptRows<=limits.records);}
   if(array)must(key===String(count));if(count++)emit(',');if(!array){stringTokens(key,emit);emit(':');}walk(d.value,depth+1);
  }
  emit(array?']':'}');ancestors.delete(v);
  }finally{keys=null;vector?.release();}
 }
 walk(value,0);return {slots,nodes,rootReceiptRows,typedRecords};
}
function measure(value,state,decoderN=null,limit=limits.logical,projection=null){const workspace=charge(state,decoderN===null?131072:vectorBase+2*decoderN,'canonical-traversal-and-scalar-scratch');try{let bytes=0;const digest=createHash('sha256');const counts=tokens(value,s=>{bytes+=Buffer.byteLength(s);must(bytes<=limit);digest.update(s);},projection,{state,incremental:decoderN===null});return{bytes,digest:digest.digest('hex'),...counts};}catch(error){if(captureObservation?.state===state&&!captureObservation.innerStage)captureObservation.innerStage='canonical-measure';if(representationObservation?.state===state){representationObservation.innerStage='canonical-measure';representationFailure();}throw error;}finally{workspace.release();}}
function canonical(value,state,N,decoder=false){const lease=charge(state,N,'canonical-buffer');try{const bytes=Buffer.allocUnsafeSlow(N);let offset=0;const workspace=charge(state,decoder?vectorBase+2*N:131072,'canonical-traversal-and-scalar-scratch');try{tokens(value,s=>{offset+=bytes.write(s,offset,N-offset);},null,{state,incremental:!decoder});must(offset===N);}catch(error){representationFailure();throw error;}finally{workspace.release();}return{bytes,lease};}catch{representationFailure();lease.release();throw bad();}}

export function packMixedTechnicalJSON(original,kind,ownerLease){
 representationStage('pack-owner');
 const state=owned(ownerLease,original),held=[];let bytes=null;
 if(representationObservation)representationObservation.state=state;
 try{representationStage('pack-kind');must(kind===1);const operation=charge(state,131072,'operation-hash-control-smallobjects');held.push(operation);representationStage('measure');const m=measure(original,state),prior=leases.get(ownerLease);representationStage('binding-match');must(m.bytes===prior.logicalBytes&&m.digest===prior.logicalSHA);representationStage('canonical');const canonicalView=canonical(original,state,m.bytes);held.push(canonicalView.lease);
  // Native documented workspace +128KiB explicit small-object allowance.
  representationStage('deflate-reserve');const native=charge(state,262144+131072,'deflate-native-and-smallobjects');held.push(native);
  const chunks=charge(state,round(limits.portable-limits.header),'deflate-output-chunks');held.push(chunks);
  const result=charge(state,round(limits.portable-limits.header)+CHUNK,'deflate-returned-buffer');held.push(result);
  representationStage('deflate-call');let gz=gzipSync(canonicalView.bytes,{level:6,windowBits:15,memLevel:8,strategy:constants.Z_DEFAULT_STRATEGY,chunkSize:CHUNK,maxOutputLength:limits.portable-limits.header});
  representationStage('resize');resize(result,gz.buffer.byteLength);chunks.release();native.release();
  representationStage('assembly-reserve');const outputLease=charge(state,limits.header+gz.length,'portable-assembly');held.push(outputLease);
  representationStage('assembly');bytes=Buffer.allocUnsafeSlow(limits.header+gz.length);bytes.write(MAGIC,0,'ascii');bytes[8]=1;bytes[9]=0;bytes.writeUInt16BE(48,10);bytes.writeUInt32BE(m.bytes,12);hash(canonicalView.bytes).copy(bytes,16);gz.copy(bytes,48);
  gz=null;result.release();canonicalView.bytes=null;canonicalView.lease.release();bind(outputLease,bytes);leases.get(outputLease).onRelease=()=>{bytes=null;};
  const stats=Object.freeze({logicalBytes:m.bytes,portableBytes:bytes.length,codecArraySlots:m.slots,logicalReceiptRows:m.rootReceiptRows,peakChargedBytes:state.peak,authority:false});operation.release();
  representationStage('return');let live=true;return Object.freeze({get bytes(){return bytes;},lease:outputLease,stats,release(){if(live){live=false;bytes=null;outputLease.release();}}});
 }catch{representationFailure();bytes=null;for(const lease of held.reverse())lease.release();throw bad();}
}

export function unpackMixedTechnicalJSON(portable,kind,ownerLease){
 const state=owned(ownerLease,portable),held=[];let value=null;
 try{const f=bufferFacts(portable);must(f.length>=48&&f.length<=limits.portable);const copyLease=charge(state,f.length,'trusted-portable-copy');held.push(copyLease);
  portable=Buffer.allocUnsafeSlow(f.length);apply(typedSet,portable,[new NativeUint8Array(f.backing,f.offset,f.length),0]);
  must(kind===1&&portable.subarray(0,8).toString('ascii')===MAGIC&&portable[8]===1&&portable[9]===0&&portable.readUInt16BE(10)===48);
  const operation=charge(state,131072,'operation-hash-control-smallobjects');held.push(operation);
  const N=portable.readUInt32BE(12);must(N>0&&N<=limits.logical);
  const native=charge(state,32768+CHUNK+131072,'inflate-native-slab-smallobjects');held.push(native);
  const chunks=charge(state,round(N),'inflate-output-chunks');held.push(chunks);
  const output=charge(state,round(N)+CHUNK,'inflate-returned-buffer');held.push(output);
  let logical=gunzipSync(portable.subarray(48),{maxOutputLength:N,rejectGarbageAfterEnd:true,chunkSize:CHUNK});must(logical.length===N);resize(output,logical.buffer.byteLength);chunks.release();native.release();must(hash(logical).equals(portable.subarray(16,48)));
  const textLease=charge(state,2*N,'fatal-UTF16-text');held.push(textLease);let text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(logical);
  const viewLease=charge(state,N,'decoded-modeled-view');held.push(viewLease);value=JSON.parse(text);text=null;textLease.release();
  const m=measure(value,state,N);must(m.bytes===N);const checked=canonical(value,state,N,true);held.push(checked.lease);must(checked.bytes.equals(logical));checked.bytes=null;checked.lease.release();logical=null;output.release();bind(viewLease,value);leases.get(viewLease).onRelease=()=>{value=null;};
  const stats=Object.freeze({logicalBytes:N,portableBytes:f.length,codecArraySlots:m.slots,logicalReceiptRows:m.rootReceiptRows,peakChargedBytes:state.peak,authority:false});portable=null;copyLease.release();operation.release();let live=true;
  return Object.freeze({get value(){return value;},lease:viewLease,stats,release(){if(live){live=false;value=null;viewLease.release();}}});
 }catch{value=null;portable=null;for(const lease of held.reverse())lease.release();throw bad();}
}

/** File acquisition remains the existing256MiB scope, not a protocol allowance.
 * JSON.parse creates the only replay premise. Reviver child summaries avoid an
 * additional unbounded own-key enumeration; unsupported ancestors stay unqualified.
 */
export function parseMixedTechnicalReplayJSON(bytes){
 qualified();let text=null,value=null;
 try{const facts=bufferFacts(bytes);must(facts.length<=256*1024*1024);const pending=new WeakMap();
  text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new NativeUint8Array(facts.backing,facts.offset,facts.length));
  const scalarBytes=part=>{let size=0;stringTokens(part,chunk=>{size+=Buffer.byteLength(chunk);});return size;};
  value=JSON.parse(text,function(key,child){
   let info;
   if(child!==null&&typeof child==='object'){
    const row=pending.get(child)??{bytes:2,count:0,depth:0,nodes:1,maxKeys:0,maxArray:0,json:true},array=Array.isArray(child);pending.delete(child);
    const width=row.count+(array?1:0),maxKeys=Math.max(width,row.maxKeys),maxArray=Math.max(array?row.count:0,row.maxArray);
    info=Object.freeze({bytes:row.json?row.bytes:null,depth:row.depth,nodes:row.nodes,maxKeys,maxArray,json:row.json,eligible:row.json&&row.bytes<=limits.logical&&row.depth<=limits.depth&&row.nodes<=1000000&&maxKeys<=10001&&maxArray<=limits.records});
    Object.freeze(child);replayFacts.set(child,info);
   }else{
    const json=typeof child!=='number'||Number.isFinite(child)&&!Object.is(child,-0),size=typeof child==='string'?scalarBytes(child):child===null?4:typeof child==='boolean'?(child?4:5):json?Buffer.byteLength(String(child)):0;
    info={bytes:size,depth:0,nodes:1,maxKeys:0,maxArray:0,json};
   }
   let parent=pending.get(this);if(!parent){parent={bytes:2,count:0,depth:0,nodes:1,maxKeys:0,maxArray:0,json:true};pending.set(this,parent);}
   if(parent.count++)parent.bytes++;if(!Array.isArray(this))parent.bytes+=scalarBytes(key)+1;
   parent.bytes+=info.bytes??0;parent.depth=Math.max(parent.depth,info.depth+1);parent.nodes+=info.nodes;parent.maxKeys=Math.max(parent.maxKeys,info.maxKeys);parent.maxArray=Math.max(parent.maxArray,info.maxArray);parent.json=parent.json&&info.json;
   return child;
  });text=null;must(value!==null&&typeof value==='object'&&replayFacts.has(value));return value;
 }catch{text=null;value=null;throw Error('Mixed technical JSON replay input rejected.');}
}
export function mixedTechnicalInputIsQualified(input){
 const held=cutLeases.get(input),record=held&&leases.get(held);
 if(record?.live)return record.value===input&&(!construction||record.state===construction.state);
 const ownedChild=ownedCutView(input);if(ownedChild)return !construction||leases.get(ownedChild.lease).state===construction.state;
 const facts=replayFacts.get(input);return Boolean(facts?.eligible&&Object.isFrozen(input)&&(!construction||ownData(ownData(input,'nativeContext'),'contextId')===construction.state.contextId));
}
/** Private exact-context cut leases share the existing proxy's one retention owner. */
let construction=null;
const collect=lease=>{construction.leases.push(lease);return lease;};
function ownedCutView(input){
 const info=ownedCutViews.get(input),held=info&&leases.get(info.lease);if(!held?.live||held.value!==info.root||!Object.isFrozen(input))return null;
 const prefix=info.index===null?info.root:ownData(ownData(info.root,'prefixes'),String(info.index));return ownData(prefix,info.side)===input?info:null;
}
function registerOwnedCutViews(lease,value,source=value){
 const held=leases.get(lease),protocol=ownData(source,'protocol'),ledger=protocol==='mixed-native-progress-observations-v1',prefixes=ledger?ownData(source,'prefixes'):null;
 const count=ledger&&!types.isProxy(prefixes)&&Array.isArray(prefixes)&&prefixes.length<=limits.records?prefixes.length:protocol==='acknowledged-mixed-native-prefix-v1'?1:0;if(!count)return;
 const metadata=charge(held.state,2048+count*512,'owned-native-subcut-provenance');const bindings=[];let attached=false;
 try{
  for(let index=0;index<count;index++){
   const before=ledger?ownData(prefixes,String(index)):source,after=ledger?ownData(ownData(value,'prefixes'),String(index)):value;
   for(const side of ['begin','end']){const original=ownData(before,side),child=ownData(after,side);if(!mixedTechnicalInputIsQualified(original)||child===null||typeof child!=='object')continue;
    if(!Object.isFrozen(value)){must(construction!==null);mixedOwnedFreeze(value);}
    const info={lease,root:value,index:ledger?index:null,side,bytes:cutLeases.has(original)?leases.get(cutLeases.get(original)).logicalBytes:replayFacts.get(original)?.bytes??ownedCutView(original)?.bytes};must(Number.isSafeInteger(info.bytes)&&info.bytes<=limits.logical);bindings.push([child,info,ownedCutViews.get(child)]);ownedCutViews.set(child,info);
   }
  }
  if(!bindings.length)return;for(const binding of bindings)binding[2]=null;const previous=held.onRelease;held.onRelease=()=>{while(bindings.length){const [child,info]=bindings.pop();if(ownedCutViews.get(child)===info)ownedCutViews.delete(child);}metadata.release();previous?.();};attached=true;
 }finally{if(!attached){for(let index=bindings.length-1;index>=0;index--){const [child,info,prior]=bindings[index];if(ownedCutViews.get(child)===info){if(prior&&leases.get(prior.lease)?.live)ownedCutViews.set(child,prior);else ownedCutViews.delete(child);}}bindings.length=0;metadata.release();}}
}
function coverWhole(lease,value,measured,rootRecords=0){
 const held=leases.get(lease);if(value===null||typeof value!=='object'||types.isProxy(value))return;
 const m=measured??measure(value,held.state,null,limits.owner);
 if(m.bytes>held.bytes||m.typedRecords+rootRecords>held.records)return;
 coverage.set(value,{kind:'whole',lease,bytes:m.bytes,digest:m.digest,records:m.typedRecords,rootRecords,arrayLength:Array.isArray(value)?value.length:null});
}
function checkCoverage(value,state,seen=new Set()){
 if(value===null||typeof value!=='object')return;
 must(!types.isProxy(value));if(seen.has(value))return;seen.add(value);const known=coverage.get(value),held=known&&leases.get(known.lease);must(held?.live&&held.state===state);
 if(known.kind==='container'){must(Object.isFrozen(value));for(const [key,child]of known.children){must(Object.getOwnPropertyDescriptor(value,key)?.value===child);checkCoverage(child,state,seen);}return;}
 const m=measure(value,state,null,limits.owner);must(m.bytes===known.bytes&&m.digest===known.digest&&m.typedRecords===known.records&&(known.arrayLength===null||value.length===known.arrayLength));
}
/** Fixed private source containers compose already charged child values. */
export function mixedOwnedFixedContainer(prepare){
 if(!construction)return Object.fromEntries(prepare());const {state}=construction,lease=collect(charge(state,8192,'fixed-source-container-and-coverage-control'));let value=null,entries=null;
 try{entries=prepare();must(!types.isProxy(entries)&&Array.isArray(entries)&&entries.length<=64);const children=[],seen=new Set();let ownBytes=3072+entries.length*48+2;const scalar=part=>{ownBytes+=Buffer.byteLength(part);must(ownBytes<=8192);};
  for(let index=0;index<entries.length;index++){
   const field=Object.getOwnPropertyDescriptor(entries,String(index)),pair=field?.value;must(field?.enumerable&&Object.hasOwn(field,'value')&&!types.isProxy(pair)&&Array.isArray(pair)&&pair.length===2);
   const keyField=Object.getOwnPropertyDescriptor(pair,'0'),valueField=Object.getOwnPropertyDescriptor(pair,'1');must(keyField?.enumerable&&valueField?.enumerable&&Object.hasOwn(keyField,'value')&&Object.hasOwn(valueField,'value'));const key=keyField.value,child=valueField.value;must(typeof key==='string'&&!seen.has(key));seen.add(key);stringTokens(key,scalar);scalar(':,');
   must(child===null||['string','number','boolean','object'].includes(typeof child));if(typeof child==='number')must(Number.isFinite(child)&&!Object.is(child,-0));
   if(child&&typeof child==='object')checkCoverage(child,state);else if(typeof child==='string')stringTokens(child,scalar);else scalar(child===null?'null':String(child));children.push([key,child]);
  }
  // Primitive/key storage and both bounded staging vectors are covered BEFORE
  // this creates the actual object. Only our fresh own-data entries are iterated.
  value=Object.fromEntries(children);for(const pair of children)Object.freeze(pair);Object.freeze(children);Object.freeze(value);bind(lease,value);coverage.set(value,{kind:'container',lease,children});return value;
 }catch{value=null;lease.release();throw bad();}finally{entries=null;}
}
/** Borrowed static metadata is copied before entering a covered source container. */
export function mixedOwnedCoveredValue(value){
 if(!construction||value===null||typeof value!=='object')return value;
 if(coverage.has(value)){checkCoverage(value,construction.state);return value;}
 return mixedOwnedClone(value);
}
/** Only closed-source snapshot constructors call these helpers. Defaults stay unchanged. */
export function mixedOwnedClone(value,records=null){
 if(!construction)return structuredClone(value);
 const {state}=construction,m=measure(value,state,null,limits.owner),lease=collect(charge(state,m.bytes,'snapshot-clone',m.typedRecords+(records??0)));
 try{const copy=structuredClone(value);bind(lease,copy);coverWhole(lease,copy,m,records??0);registerOwnedCutViews(lease,copy,value);return copy;}catch{lease.release();throw bad();}
}
/** Reiterable private source collection; measurement never invokes the projector. */
export function mixedOwnedRows(source,project,{keys=null,omit=null,extraBytesPerRow=0,constructorScratchBytes=0,constructorViewCopies=0,sort=null}={}){
 if(!construction){const values=source(),rows=Array.isArray(values)?values.map(project):Array.from(values,project);return sort?rows.sort(sort):rows;}
 const {state}=construction;let bytes=2,count=0,nestedRecords=0,maxRowBytes=0;
 for(const row of source()){must(++count<=limits.records);const measured=measure(row,state,null,limits.owner,{keys,omit});nestedRecords+=measured.typedRecords;maxRowBytes=Math.max(maxRowBytes,measured.bytes);bytes+=measured.bytes+extraBytesPerRow+(count>1?1:0);must(bytes<=limits.owner);}
 must(Number.isSafeInteger(constructorScratchBytes)&&constructorScratchBytes>=0&&Number.isSafeInteger(constructorViewCopies)&&constructorViewCopies>=0&&constructorViewCopies<=4);
 const lease=collect(charge(state,bytes,'snapshot-typed-rows',count+nestedRecords));let scratch=null,sorting=null;
 try{if(count&&(constructorScratchBytes||constructorViewCopies))scratch=charge(state,constructorScratchBytes+constructorViewCopies*maxRowBytes,'sequential-row-constructor-scratch');const rows=Array.from(source(),project);must(rows.length===count);if(sort){sorting=charge(state,2048+count*16,'snapshot-row-sort-index');rows.sort(sort);}bind(lease,rows);coverWhole(lease,rows,null,count);return rows;}catch{lease.release();throw bad();}finally{sorting?.release();scratch?.release();}
}
/** Closed constructors supply a source-justified count/element storage bound. */
export function mixedOwnedArray(count,construct,{bytesPerEntry=8,records=0}={}){
 if(!construction)return construct();
 must(Number.isSafeInteger(count)&&count>=0&&count<=limits.records&&Number.isSafeInteger(bytesPerEntry)&&bytesPerEntry>=8);
 const lease=collect(charge(construction.state,2048+count*bytesPerEntry,'snapshot-bounded-array',records));
 try{const value=construct();bind(lease,value);if(records||!types.isProxy(value)&&Array.isArray(value)&&value.every(item=>item===null||["string","boolean","number"].includes(typeof item)))coverWhole(lease,value,null,records&&Array.isArray(value)?value.length:0);return value;}catch{lease.release();throw bad();}
}
/** Synchronous predicate temporaries end before the next existing predicate executes. */
export function mixedOwnedOperation(construct,{retainResult=false}={}){
 if(!construction)return construct();
 const parent=construction,frame={state:parent.state,leases:[charge(parent.state,131072,'technical-predicate-fixed-shells')]};let result=null;
 construction=frame;
 try{
  result=construct();
  if(retainResult&&result!==null&&typeof result==='object'){
   const measured=measure(result,parent.state,null,limits.owner),lease=charge(parent.state,measured.bytes+2048,'technical-predicate-return-view',measured.typedRecords);bind(lease,result);coverWhole(lease,result,measured);parent.leases.push(lease);
  }
  return result;
 }finally{construction=parent;for(const lease of frame.leases.reverse())lease.release();}
}
/** Precharge a derived receipt before its fixed-key constructor executes. */
export function mixedOwnedProjectedValue(source,construct,{keys=null,omit=null,extraBytes=2048,records=1,copies=1}={}){
 if(!construction)return construct();
 must(Number.isSafeInteger(copies)&&copies>=1&&copies<=4);
 const {state}=construction,m=measure(source,state,null,limits.owner,{keys,omit}),lease=collect(charge(state,copies*m.bytes+extraBytes,'derived-technical-receipt',records+m.typedRecords));
 try{const value=construct();bind(lease,value);return value;}catch{lease.release();throw bad();}
}
/** A filter creates an index/reference vector; source rows keep their existing leases. */
export function mixedOwnedFilter(source,predicate){return construction?mixedOwnedArray(source.length,()=>source.filter(predicate)):source.filter(predicate);}
export function mixedOwnedOptionalFilter(source,predicate){return source===null||source===undefined?undefined:mixedOwnedFilter(source,predicate);}
export function mixedOwnedMap(source,project){return construction?mixedOwnedArray(source.length,()=>source.map(project),{bytesPerEntry:128}):source.map(project);}
export function mixedOwnedSlice(source,...args){return construction?mixedOwnedArray(source.length,()=>source.slice(...args)):source.slice(...args);}
/** Per source row: bounded identifier splitting plus Map/Set and ordinal/index slots. */
export function mixedOwnedIndexWork(count){if(construction)mixedOwnedArray(count,()=>null,{bytesPerEntry:256});}
export function mixedOwnedLazyValue(prepare,construct,options){return construction?mixedOwnedProjectedValue(prepare(),construct,options):construct();}
export function mixedOwnedHashInput(value){return construction&&typeof value==='string'?mixedOwnedUTF8(value):value;}
export function mixedOwnedFreeze(value){
 must(construction!==null);const workspace=collect(charge(construction.state,vectorBase,'immutable-snapshot-key-vectors')),ancestors=new Set();let nodes=0;
 const freeze=(item,depth)=>{
  must(depth<=limits.depth&&++nodes<=1000000);if(item===null||typeof item!=='object')return;
  must(!types.isProxy(item)&&!ancestors.has(item));if(Object.isFrozen(item))return;
  const keys=Reflect.ownKeys(item);must(keys.length<=10001);ancestors.add(item);
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(item,key);must(descriptor&&Object.hasOwn(descriptor,'value'));freeze(descriptor.value,depth+1);}
  ancestors.delete(item);Object.freeze(item);
 };
 try{freeze(value,0);return value;}finally{workspace.release();}
}
export function mixedOwnedJSONString(value,serialize=JSON.stringify){
 if(!construction||value===undefined)return serialize(value);
 const {state}=construction,m=measure(value,state,null,limits.owner),lease=collect(charge(state,2*m.bytes,'snapshot-UTF16-string'));
 try{const text=serialize(value);bind(lease,text);return text;}catch{lease.release();throw bad();}
}
export function mixedOwnedUTF8(value,encode=Buffer.from){
 if(!construction)return encode(value);
 must(typeof value==='string');const lease=collect(charge(construction.state,Buffer.byteLength(value),'snapshot-UTF8-buffer'));
 try{const bytes=encode(value);bind(lease,bytes);return bytes;}catch{lease.release();throw bad();}
}
export function createMixedTechnicalOwner(options){
 qualified();
 const contextId=ownData(options,'contextId'),reserve=ownData(options,'reserve'),release=ownData(options,'release'),reserveRecords=ownData(options,'reserveRecords'),releaseRecords=ownData(options,'releaseRecords');
 must(typeof contextId==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(contextId)&&[reserve,release,reserveRecords,releaseRecords].every(value=>typeof value==='function'&&!types.isProxy(value)));
 const owner=createBoundedOwner({reserve,release,reserveRecords,releaseRecords}),cuts=new Map(),evidence=new Map(),outputs=new Set(),reads=new Set();let closed=false,allocatingRead=null,pendingExport=false;
 const state=states.get(owner);state.contextId=contextId;
 const api=Object.freeze({
  capture(construct){
   const diagnostic=captureObservation?.state===null?captureObservation:null;if(diagnostic){diagnostic.state=state;diagnostic.stage='entry';}
   must(!closed&&typeof construct==='function'&&construction===null);let lease,view=null,copy=null;
   if(diagnostic)diagnostic.stage='constructor-shell';
   const frame={state,leases:[]};const shell=charge(state,131072,'snapshot-fixed-constructor-shells');frame.leases.push(shell);construction=frame;
   try{
    if(diagnostic)diagnostic.stage='construct';view=construct();if(diagnostic)diagnostic.stage='context';must(ownData(ownData(view,'nativeContext'),'contextId')===contextId);let measured;
    if(coverage.get(view)?.kind==='container'){if(diagnostic)diagnostic.stage='coverage';checkCoverage(view,state);if(diagnostic)diagnostic.stage='measure';measured=measure(view,state);}
    else{if(diagnostic)diagnostic.stage='source-pin';lease=owner.holdSourceValue(view);const previous=leases.get(lease);measured={bytes:previous.bytes,digest:previous.logicalSHA,typedRecords:previous.typedRecords};}
    if(diagnostic)diagnostic.stage='clone-reservation';
    const cloneLease=charge(state,measured.bytes+2048,'complete-progress-cut-clone-and-private-control',measured.typedRecords);
    try{if(diagnostic)diagnostic.stage='clone';copy=structuredClone(view);if(diagnostic)diagnostic.stage='clone-coverage';bind(cloneLease,copy);coverWhole(cloneLease,copy,measured);Object.assign(leases.get(cloneLease),{logicalBytes:measured.bytes,logicalSHA:measured.digest});}catch{cloneLease.release();throw bad();}
    if(diagnostic)diagnostic.stage='publish';view=null;lease?.release();lease=null;cuts.set(copy,cloneLease);cutLeases.set(copy,cloneLease);return copy;
   }catch{if(diagnostic){diagnostic.used=state.used;diagnostic.records=state.records;}view=null;copy=null;try{lease?.release();}catch(error){if(diagnostic){diagnostic.stage='cleanup';diagnostic.used=state.used;diagnostic.records=state.records;}throw error;}throw bad();}
   finally{construction=null;try{for(const ownedLease of frame.leases.reverse())ownedLease.release();}catch(error){if(diagnostic){diagnostic.stage='cleanup';diagnostic.used=state.used;diagnostic.records=state.records;}throw error;}}
  },
  replay(value){
   must(!closed&&!cutLeases.has(value)&&replayFacts.get(value)?.eligible&&Object.isFrozen(value)&&ownData(ownData(value,'nativeContext'),'contextId')===contextId);const known=replayFacts.get(value),pin=charge(state,known.bytes,'bounded-json-replay-source-pin');let retained=null;
   try{const m=measure(value,state,known.bytes);must(m.bytes===known.bytes);retained=charge(state,m.bytes+2048,'bounded-json-replay-view-and-control',m.typedRecords);bind(retained,value);Object.assign(leases.get(retained),{logicalBytes:m.bytes,logicalSHA:m.digest});registerOwnedCutViews(retained,value);cuts.set(value,retained);cutLeases.set(value,retained);return value;}catch{representationFailure();retained?.release();throw bad();}finally{pin.release();}
  },
  encode(value){
   must(!closed&&cuts.has(value));const packed=packMixedTechnicalJSON(value,1,cuts.get(value));outputs.add(packed);
   return Object.freeze({get bytes(){return packed.bytes;},stats:packed.stats,release(){outputs.delete(packed);packed.release();}});
  },
  retainEvidence(construct){
   must(!closed&&typeof construct==='function'&&construction===null);const frame={state,leases:[]};frame.leases.push(charge(state,131072,'evidence-fixed-shells'));construction=frame;let result=null,lease=null;
   try{result=construct();if(result===null||result===undefined)return result;must(typeof result==='object'&&!types.isProxy(result));const m=measure(result,state,null,limits.owner);lease=charge(state,m.bytes+2048,'retained-technical-evidence-and-private-control',m.typedRecords);bind(lease,result);must(!evidence.has(result));registerOwnedCutViews(lease,result);evidence.set(result,lease);leases.get(lease).pendingConsumer=pendingExport;if(allocatingRead){leases.get(lease).readScope=allocatingRead;allocatingRead.values.add(result);}lease=null;return result;}
   catch(error){result=null;lease?.release();throw error;}
   finally{construction=null;for(const ownedLease of frame.leases.reverse())ownedLease.release();}
  },
  run(construct){
   must(!closed&&typeof construct==='function');if(construction){must(construction.state===state);return construct();}
   const frame={state,leases:[charge(state,131072,'technical-operation-shells')]};construction=frame;
   try{return construct();}finally{construction=null;for(const ownedLease of frame.leases.reverse())ownedLease.release();}
  },
  openRead(){
   must(!closed);const control=charge(state,131072,'pending-read-fixed-constructors-and-control',1),scope={active:true,values:new Set()};reads.add(scope);
   return Object.freeze({
    keep(construct){must(scope.active);const previous=allocatingRead;allocatingRead=scope;try{return api.retainEvidence(construct);}finally{allocatingRead=previous;}},
    run(construct){must(scope.active);return api.run(construct);},
    finish(){if(!scope.active)return;scope.active=false;for(const value of scope.values){scope.values.delete(value);api.releaseEvidence(value);}reads.delete(scope);control.release();},
   });
  },
  retainReadResult(construct){const previous=pendingExport;pendingExport=true;try{return api.retainEvidence(construct);}finally{pendingExport=previous;}},
  releaseEvidence(value){const lease=evidence.get(value);if(lease){must(!leases.get(lease).readScope?.active);evidence.delete(value);lease.release();}},
  releaseCut(value){const lease=cuts.get(value);if(lease){cuts.delete(value);cutLeases.delete(value);lease.release();}},
  close(){if(closed)return;closed=true;for(const packed of outputs){outputs.delete(packed);packed.release();}for(const [value,lease]of cuts){cuts.delete(value);cutLeases.delete(value);lease.release();}for(const [value,lease]of evidence){const held=leases.get(lease);if(held.readScope?.active||held.pendingConsumer)continue;evidence.delete(value);lease.release();}},
  stats(){const snapshot=owner.snapshot();let pendingConsumers=0;for(const lease of evidence.values())if(leases.get(lease).pendingConsumer)pendingConsumers++;return {retainedBytes:snapshot.used,peakBytes:snapshot.peak,retainedRecords:state.records,liveCuts:cuts.size,pendingReads:reads.size,pendingConsumers,closed};},
 });
 return api;
}

/** Same representation check for a private live cut or a separately bounded replay operation. */
export function mixedTechnicalCandidateDigest(input,onReport){
 const previous=representationObservation,observed=!types.isProxy(onReport)&&typeof onReport==='function',scope=observed?{state:null,stage:'qualification',innerStage:null,refusal:null,parent:null,failure:null}:null;representationObservation=scope;
 let temporary=null,borrow=null,packed=null,held=cutLeases.get(input),bytes=0,records=0,report={protocol:mixedTechnicalRepresentation.protocol,serialized:null,logicalBytes:null,encodedBytes:null,withinLimit:null,outcome:'representation-rejected'};
 try{
  qualified();representationStage('owner-join');must(!held||!construction||leases.get(held)?.state===construction.state);
  representationStage('owned-subcut');if(!held&&ownedCutView(input)){const info=ownedCutView(input),state=leases.get(info.lease).state;must(!construction||state===construction.state);borrow=charge(state,2048,'owned-native-subcut-borrow');bind(borrow,input);const measured=measure(input,state);must(measured.bytes===info.bytes);Object.assign(leases.get(borrow),{logicalBytes:measured.bytes,logicalSHA:measured.digest});held=borrow;}
  representationStage('replay-subcut');if(!held&&construction){must(mixedTechnicalInputIsQualified(input));const known=replayFacts.get(input);must(known?.eligible);const pin=charge(construction.state,known.bytes,'candidate-replay-source-pin');try{const measured=measure(input,construction.state,known.bytes);must(measured.bytes===known.bytes);borrow=charge(construction.state,measured.bytes+2048,'candidate-subcut-view',measured.typedRecords);bind(borrow,input);Object.assign(leases.get(borrow),{logicalBytes:measured.bytes,logicalSHA:measured.digest});held=borrow;}catch(error){representationFailure();throw error;}finally{pin.release();}}
  if(!held){
   representationStage('fallback-replay');must(mixedTechnicalInputIsQualified(input));temporary=createMixedTechnicalOwner({contextId:ownData(ownData(input,'nativeContext'),'contextId'),
    reserve:n=>{if(bytes+n>limits.owner)return false;bytes+=n;return true;},release:n=>{bytes-=n;},
    reserveRecords:n=>{if(records+n>limits.records)return false;records+=n;return true;},releaseRecords:n=>{records-=n;}});
   input=temporary.replay(input);held=cutLeases.get(input);
  }
  packed=packMixedTechnicalJSON(input,1,held);
  report={protocol:mixedTechnicalRepresentation.protocol,serialized:true,logicalBytes:packed.stats.logicalBytes,encodedBytes:packed.stats.portableBytes,withinLimit:true,outcome:'complete'};
  return packed.bytes.subarray(16,48).toString('hex');
 }catch{representationFailure();if(scope?.failure)report.failure=scope.failure;return null;}
 finally{
  try{packed?.release();borrow?.release();temporary?.close();}
  finally{representationObservation=previous;if(scope){scope.state=null;scope.refusal=null;scope.parent=null;scope.failure=null;}}
  try{if(observed)onReport(report);}catch{}
 }
}
