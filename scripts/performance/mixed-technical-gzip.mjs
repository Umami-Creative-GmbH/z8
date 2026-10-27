/** Candidate-only technical representation. Source owners reserve before constructing views. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {gzipSync,gunzipSync,constants} from 'node:zlib';
export const limits=Object.freeze({portable:4194304,logical:8388608,owner:33554432,records:10000,depth:64,header:48});
export const mixedTechnicalRepresentation=Object.freeze({protocol:'mixed-progress-technical-gzip-v1',kind:1,portableLimit:4194304,logicalLimit:8388608,retainedLimit:33554432,recordLimit:10000,owner:'existing-proxy-temporary-observation-owner-v1',accounting:'modeled-serialized-views-plus-explicit-buffers-v1'});
const states=new WeakMap(), leases=new WeakMap(), MAGIC='Z8MIXGZ2', CHUNK=65536;
const bad=()=>new Error('Bounded technical gzip prototype rejected input.');
const must=x=>{if(!x)throw bad();};
const hash=b=>createHash('sha256').update(b).digest();
const round=n=>Math.ceil(n/CHUNK)*CHUNK;
// Root depth0 through depth64 can retain65 vectors simultaneously.
const vectorBase=65*10001*8+131072;
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const intrinsicGetter=(prototype,key)=>Object.getOwnPropertyDescriptor(prototype,key).get;
const getBuffer=intrinsicGetter(typedPrototype,'buffer'),getLength=intrinsicGetter(typedPrototype,'byteLength'),getOffset=intrinsicGetter(typedPrototype,'byteOffset');
const getBackingLength=intrinsicGetter(ArrayBuffer.prototype,'byteLength'),getResizable=intrinsicGetter(ArrayBuffer.prototype,'resizable'),getDetached=intrinsicGetter(ArrayBuffer.prototype,'detached');
const bufferPrototype=Buffer.prototype,apply=Reflect.apply,NativeUint8Array=Uint8Array,typedSet=Uint8Array.prototype.set;
function bufferFacts(bytes){try{
 must(!types.isProxy(bytes)&&types.isUint8Array(bytes)&&Object.getPrototypeOf(bytes)===bufferPrototype);const backing=apply(getBuffer,bytes,[]);
 must(!types.isSharedArrayBuffer(backing)&&!apply(getResizable,backing,[])&&!apply(getDetached,backing,[]));
 const length=apply(getLength,bytes,[]),offset=apply(getOffset,bytes,[]),backingLength=apply(getBackingLength,backing,[]);must(length>0&&backingLength>0&&offset+length<=backingLength);
 return {backing,offset,length,backingLength};
 }catch{throw bad();}}

// Explicit modeled serialized views; buffers/UTF16/workspace charged separately.
// This synthetic owner does not certify any existing collector's allocations.
function createBoundedOwner({reserve,release}){
 const state={used:0,peak:0,attempts:0,active:0,records:0,reserve,release};
  // Closed source constructor ONLY: every own-key width<=10001,
 // array length<=10000 and depth<=64 is known BEFORE entry. No eligibility flag.
 // Unknown arbitrary graphs must not invoke this constructor.
 const api=Object.freeze({holdSourceValue(value){
  const provisional=charge(state,limits.logical,'original-provisional');
  try{const m=measure(value,state);resize(provisional,m.bytes);bind(provisional,value);Object.assign(leases.get(provisional),{logicalBytes:m.bytes,logicalSHA:m.digest});return provisional;}catch{provisional.release();throw bad();}
 },holdPortable(bytes){const f=bufferFacts(bytes);must(f.length<=limits.portable);const lease=charge(state,f.backingLength,'portable-input');bind(lease,bytes);return lease;},snapshot:()=>Object.freeze({used:state.used,peak:state.peak,active:state.active,attempts:state.attempts,metric:'modeled-serialized-views-plus-explicit-buffer-string-workspace'})});
 states.set(api,state);return api;
}
function charge(state,bytes,label,records=0){
 must(Number.isSafeInteger(bytes)&&bytes>=0);state.attempts++;
 must(Number.isSafeInteger(records)&&records>=0&&state.records+records<=limits.records&&state.used+bytes<=limits.owner&&state.reserve(bytes)===true);
 state.records+=records;
 state.used+=bytes;state.peak=Math.max(state.peak,state.used);state.active++;
 const lease=Object.freeze({release(){const s=leases.get(lease);if(s.live){s.onRelease?.();s.value=null;s.logicalSHA=null;s.live=false;state.used-=s.bytes;state.active--;state.records-=s.records;state.release(s.bytes);}}});
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
function tokens(value,emit,projection=null){
 const ancestors=new Set();let slots=0,nodes=0,rootReceiptRows=0;
 function walk(v,depth){must(depth<=limits.depth&&++nodes<=1000000);
  if(v===null){emit('null');return;}if(typeof v==='string'){stringTokens(v,emit);return;}
  if(typeof v==='boolean'){emit(v?'true':'false');return;}
  if(typeof v==='number'){must(Number.isFinite(v)&&!Object.is(v,-0));emit(String(v));return;}
  must(v&&typeof v==='object'&&!types.isProxy(v)&&!ancestors.has(v));
  const array=Array.isArray(v);must(Object.getPrototypeOf(v)===(array?Array.prototype:Object.prototype));
  if(array)must(v.length<=limits.records);
  const keys=Reflect.ownKeys(v);must(keys.length<=10001&&keys.every(k=>typeof k==='string'));
  ancestors.add(v);emit(array?'[':'{');let count=0;
  if(array){must(keys.length===v.length+1&&keys.at(-1)==='length');slots+=v.length;}
  for(const key of keys){if(array&&key==='length')continue;if(depth===0&&projection&&(projection.keys&&!projection.keys.includes(key)||projection.omit?.includes(key)))continue;const d=Object.getOwnPropertyDescriptor(v,key);must(d&&Object.hasOwn(d,'value')&&d.enumerable);if(depth===0&&projection&&d.value===undefined)continue;
   if(depth===0&&['failures','responses','proxy'].includes(key)&&!types.isProxy(d.value)&&Array.isArray(d.value)){rootReceiptRows+=d.value.length;must(rootReceiptRows<=limits.records);}
   if(array)must(key===String(count));if(count++)emit(',');if(!array){stringTokens(key,emit);emit(':');}walk(d.value,depth+1);
  }
  emit(array?']':'}');ancestors.delete(v);
 }
 walk(value,0);return {slots,nodes,rootReceiptRows};
}
function measure(value,state,decoderN=null,limit=limits.logical,projection=null){const workspace=charge(state,vectorBase+(decoderN===null?0:2*decoderN),'canonical-traversal-and-scalar-scratch');try{let bytes=0;const digest=createHash('sha256');const counts=tokens(value,s=>{bytes+=Buffer.byteLength(s);must(bytes<=limit);digest.update(s);},projection);return{bytes,digest:digest.digest('hex'),...counts};}finally{workspace.release();}}
function canonical(value,state,N,decoder=false){const lease=charge(state,N,'canonical-buffer');try{const bytes=Buffer.allocUnsafeSlow(N);let offset=0;const workspace=charge(state,vectorBase+(decoder?2*N:0),'canonical-traversal-and-scalar-scratch');try{tokens(value,s=>{offset+=bytes.write(s,offset,N-offset);});must(offset===N);}finally{workspace.release();}return{bytes,lease};}catch{lease.release();throw bad();}}

export function packMixedTechnicalJSON(original,kind,ownerLease){
 const state=owned(ownerLease,original),held=[];let bytes=null;
 try{must(kind===1);const operation=charge(state,131072,'operation-hash-control-smallobjects');held.push(operation);const m=measure(original,state),prior=leases.get(ownerLease);must(m.bytes===prior.logicalBytes&&m.digest===prior.logicalSHA);const canonicalView=canonical(original,state,m.bytes);held.push(canonicalView.lease);
  // Native documented workspace +128KiB explicit small-object allowance.
  const native=charge(state,262144+131072,'deflate-native-and-smallobjects');held.push(native);
  const chunks=charge(state,round(limits.portable-limits.header),'deflate-output-chunks');held.push(chunks);
  const result=charge(state,round(limits.portable-limits.header)+CHUNK,'deflate-returned-buffer');held.push(result);
  let gz=gzipSync(canonicalView.bytes,{level:6,windowBits:15,memLevel:8,strategy:constants.Z_DEFAULT_STRATEGY,chunkSize:CHUNK,maxOutputLength:limits.portable-limits.header});
  resize(result,gz.buffer.byteLength);chunks.release();native.release();
  const outputLease=charge(state,limits.header+gz.length,'portable-assembly');held.push(outputLease);
  bytes=Buffer.allocUnsafeSlow(limits.header+gz.length);bytes.write(MAGIC,0,'ascii');bytes[8]=1;bytes[9]=0;bytes.writeUInt16BE(48,10);bytes.writeUInt32BE(m.bytes,12);hash(canonicalView.bytes).copy(bytes,16);gz.copy(bytes,48);
  gz=null;result.release();canonicalView.bytes=null;canonicalView.lease.release();bind(outputLease,bytes);leases.get(outputLease).onRelease=()=>{bytes=null;};
  const stats=Object.freeze({logicalBytes:m.bytes,portableBytes:bytes.length,codecArraySlots:m.slots,logicalReceiptRows:m.rootReceiptRows,peakChargedBytes:state.peak,authority:false});operation.release();
  let live=true;return Object.freeze({get bytes(){return bytes;},lease:outputLease,stats,release(){if(live){live=false;bytes=null;outputLease.release();}}});
 }catch{bytes=null;for(const lease of held.reverse())lease.release();throw bad();}
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

/** Private exact-context cut leases share the existing proxy's one retention owner. */
let construction=null;
const collect=lease=>{construction.leases.push(lease);return lease;};
/** Only closed-source snapshot constructors call these helpers. Defaults stay unchanged. */
export function mixedOwnedClone(value,records=0){
 if(!construction)return structuredClone(value);
 const {state}=construction,m=measure(value,state,null,limits.owner),lease=collect(charge(state,m.bytes,'snapshot-clone',records));
 try{const copy=structuredClone(value);bind(lease,copy);return copy;}catch{lease.release();throw bad();}
}
/** Reiterable private source collection; measurement never invokes the projector. */
export function mixedOwnedRows(source,project,{keys=null,omit=null,extraBytesPerRow=0}={}){
 if(!construction){const values=source();return Array.isArray(values)?values.map(project):Array.from(values,project);}
 const {state}=construction;let bytes=2,count=0;
 for(const row of source()){must(++count<=limits.records);bytes+=measure(row,state,null,limits.owner,{keys,omit}).bytes+extraBytesPerRow+(count>1?1:0);must(bytes<=limits.owner);}
 const lease=collect(charge(state,bytes,'snapshot-typed-rows',count));
 try{const rows=Array.from(source(),project);must(rows.length===count);bind(lease,rows);return rows;}catch{lease.release();throw bad();}
}
/** Closed constructors supply a source-justified count/element storage bound. */
export function mixedOwnedArray(count,construct,{bytesPerEntry=8,records=0}={}){
 if(!construction)return construct();
 must(Number.isSafeInteger(count)&&count>=0&&count<=limits.records&&Number.isSafeInteger(bytesPerEntry)&&bytesPerEntry>=8);
 const lease=collect(charge(construction.state,2048+count*bytesPerEntry,'snapshot-bounded-array',records));
 try{const value=construct();bind(lease,value);return value;}catch{lease.release();throw bad();}
}
export function mixedOwnedHashInput(value){return construction&&typeof value==='string'?mixedOwnedUTF8(value):value;}
export function mixedOwnedJSONString(value){
 if(!construction)return JSON.stringify(value);
 const {state}=construction,m=measure(value,state,null,limits.owner),lease=collect(charge(state,2*m.bytes,'snapshot-UTF16-string'));
 try{const text=JSON.stringify(value);bind(lease,text);return text;}catch{lease.release();throw bad();}
}
export function mixedOwnedUTF8(value){
 if(!construction)return Buffer.from(value);
 must(typeof value==='string');const lease=collect(charge(construction.state,Buffer.byteLength(value),'snapshot-UTF8-buffer'));
 try{const bytes=Buffer.from(value);bind(lease,bytes);return bytes;}catch{lease.release();throw bad();}
}
export function createMixedTechnicalOwner({contextId,reserve,release}){
 const owner=createBoundedOwner({reserve,release}),cuts=new Map(),outputs=new Set();let closed=false;
 const state=states.get(owner);
 return Object.freeze({
  capture(construct){
   must(!closed&&typeof construct==='function'&&construction===null);let lease,view=null,copy=null;
   const frame={state,leases:[]};const shell=charge(state,131072,'snapshot-fixed-constructor-shells');frame.leases.push(shell);construction=frame;
   try{
    view=construct();must(view?.nativeContext?.contextId===contextId);lease=owner.holdSourceValue(view);
    const previous=leases.get(lease),cloneLease=charge(state,previous.bytes,'complete-progress-cut-clone');
    try{copy=structuredClone(view);bind(cloneLease,copy);Object.assign(leases.get(cloneLease),{logicalBytes:previous.logicalBytes,logicalSHA:previous.logicalSHA});}catch{cloneLease.release();throw bad();}
    view=null;lease.release();lease=null;cuts.set(copy,cloneLease);return copy;
   }catch{view=null;copy=null;lease?.release();throw bad();}
   finally{construction=null;for(const ownedLease of frame.leases.reverse())ownedLease.release();}
  },
  encode(value){
   must(!closed&&cuts.has(value));const packed=packMixedTechnicalJSON(value,1,cuts.get(value));outputs.add(packed);
   return Object.freeze({get bytes(){return packed.bytes;},stats:packed.stats,release(){outputs.delete(packed);packed.release();}});
  },
  releaseCut(value){const lease=cuts.get(value);if(lease){cuts.delete(value);lease.release();}},
  close(){if(closed)return;closed=true;for(const packed of outputs){outputs.delete(packed);packed.release();}for(const [value,lease]of cuts){cuts.delete(value);lease.release();}},
  stats(){const snapshot=owner.snapshot();return {retainedBytes:snapshot.used,peakBytes:snapshot.peak,liveCuts:cuts.size,closed};},
 });
}
