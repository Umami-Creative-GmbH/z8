import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
let png=0,json=0;
async function scan(dir){
 for(const e of await readdir(dir,{withFileTypes:true})){
  const p=join(dir,e.name);
  if(e.isDirectory())await scan(p);
  else if(p.endsWith('.json')){JSON.parse(await readFile(p,'utf8'));json++;}
  else if(p.endsWith('.png')){
   const b=await readFile(p);assert.equal(b.readUInt32BE(0),0x89504e47);const parts=[];
   for(let n=8;n<b.length;){const size=b.readUInt32BE(n),kind=b.toString('ascii',n+4,n+8);if(kind==='IDAT')parts.push(b.subarray(n+8,n+8+size));n+=size+12;}
   assert.ok(inflateSync(Buffer.concat(parts)).length);png++;
  }
 }
}
await scan('docs/design/rollout-1692/1716');
console.log(JSON.stringify({pngDataDecompressed:png,jsonParsed:json}));
