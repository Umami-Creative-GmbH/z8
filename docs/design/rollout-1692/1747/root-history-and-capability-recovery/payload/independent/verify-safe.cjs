'use strict';
// Read-only independent payload verifier. Built-in filesystem/crypto only.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const base=__dirname;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(ok,m)=>{if(!ok)throw Error(m);};
function read(p){
 assert(typeof p==='string'&&p&&!p.includes('\\')&&!p.includes(':')&&!p.startsWith('/')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe allowlist path');
 let current=base;for(const x of p.split('/')){current=path.join(current,x);assert(!fs.lstatSync(current).isSymbolicLink(),'Symlink');}
 return fs.readFileSync(current);
}
function walk(dir,prefix=''){
 let files=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  assert(!e.isSymbolicLink(),'Symlink');const p=prefix+e.name;
  if(e.isDirectory())files=files.concat(walk(path.join(dir,e.name),p+'/'));
  else {assert(e.isFile(),'Not regular file');files.push(p);}
 }return files.sort();
}
const seal=JSON.parse(read('seal.json')),indexBytes=read('SHA256.json'),index=JSON.parse(indexBytes);
assert(indexBytes.length===seal.index.bytes&&sha(indexBytes)===seal.index.sha256,'Index seal');
assert(index.verifiedCommit===null&&seal.verifiedCommit===null,'Readiness');
assert(index.frozenHead==='cab95aa79d6b0ece4de541fa60c9d99805918a57'&&index.appTree==='52a1d43790178ca6794fd5b682e3cad4bb0cb19c','Pins');
assert(new Set(index.files.map(f=>f.path)).size===index.files.length,'Duplicate payload');
assert(JSON.stringify(walk(base))===JSON.stringify([...index.files.map(f=>f.path),'SHA256.json','seal.json'].sort()),'Membership');
let bytes=0;for(const f of index.files){const b=read(f.path);assert(b.length===f.bytes&&sha(b)===f.sha256,'Byte hash '+f.path);bytes+=b.length;if(f.path.endsWith('.json'))JSON.parse(b);}
assert(bytes===index.payloadBytes&&bytes===seal.payloadBytes&&index.files.length===seal.payloadFiles,'Totals');
const cases=JSON.parse(read('case-multiset.json'));
assert(cases.latest.length===253&&new Set(cases.latest.map(x=>JSON.stringify([x.file,x.fullName,x.occurrence]))).size===253&&cases.latest.every(x=>x.status==='passed'),'Cases');
const resources=JSON.parse(read('resource-release.json'));
assert(resources.processInventorySucceeded&&resources.ownedLiveProcessCount===0&&!resources.indexLockPresent&&!resources.status.length&&!resources.stagedPaths.length,'Release');
console.log(JSON.stringify({status:'PASS',payloadFiles:index.fileCount,totalFiles:walk(base).length,payloadBytes:bytes,indexSha256:sha(indexBytes),sealSha256:sha(read('seal.json')),uniqueCaseIdentities:253,verifiedCommit:null}));
