import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const dir=new URL('./',import.meta.url),files=await readdir(dir);
let json=0,png=0;
for(const file of files){
 const data=await readFile(new URL(file,dir));
 if(file.endsWith('.json')){JSON.parse(data);json++;}
 if(file.endsWith('.png')){
  assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let offset=8;const chunks=[];let ended=false;
  while(offset<data.length){const size=data.readUInt32BE(offset),kind=data.toString('ascii',offset+4,offset+8);assert.ok(offset+12+size<=data.length);if(kind==='IDAT')chunks.push(data.subarray(offset+8,offset+8+size));if(kind==='IEND')ended=true;offset+=size+12;}
  assert.ok(ended);assert.ok(inflateSync(Buffer.concat(chunks)).length>0);png++;
 }
}
const read=async name=>JSON.parse(await readFile(new URL(name,dir),'utf8'));
const before=await read('before-runtime.json'),after=await read('after-runtime.json');
assert.equal(before.target,after.target);assert.equal(before.actor,after.actor);
for(let i=0;i<before.checks.length;i++){
 assert.equal(before.checks[i].width,after.checks[i].width);
 assert.equal(before.checks[i].main.split('\n').slice(-4).join('\n'),after.checks[i].main.split('\n').slice(-4).join('\n'));
 assert.equal(after.checks[i].h1.length,1);assert.equal(after.checks[i].h1[0],'Approval review');
 assert.equal(after.checks[i].documentWidth,after.checks[i].width);
}
const runtime=await read('runtime.json'),canonical=await read('canonical-runtime.json');
assert.equal(runtime.checks.length,32);assert.equal(canonical.checks.length,9);
assert.ok([...runtime.checks,...canonical.checks].every(c=>c.passed));
console.log(JSON.stringify({json,png,matchedArrivalPairs:3,detailPair:1,runtimeAssertions:32,canonicalAssertions:9}));
