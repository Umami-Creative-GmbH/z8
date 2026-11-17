import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=(path,bytes)=>path.endsWith('.png')?bytes:Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const readJson=name=>JSON.parse(readFileSync(join(directory,name),'utf8').replace(/^\uFEFF/,''));
const index=readJson('index.json'),seal=readJson('seal.json');
assert.equal(digest(canonical('index.json',readFileSync(join(directory,'index.json')))),seal.indexSha256);
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
function png(bytes){
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 let width,height,channels,offset=8,end=false;const chunks=[];
 while(offset<bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),body=bytes.subarray(offset+8,offset+8+length);assert.equal(crc32(bytes.subarray(offset+4,offset+8+length)),bytes.readUInt32BE(offset+8+length));
  if(type==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);assert.equal(body[8],8);assert.ok([2,6].includes(body[9]));channels=body[9]===6?4:3;assert.equal(body[12],0);}
  if(type==='IDAT')chunks.push(body);if(type==='IEND'){end=true;offset+=length+12;break;}offset+=length+12;
 }
 assert.ok(end);assert.equal(offset,bytes.length);const stride=width*channels,data=inflateSync(Buffer.concat(chunks));assert.equal(data.length,height*(stride+1));const pixels=Buffer.alloc(height*stride);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let row=0;row<height;row++){const filter=data[row*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const target=row*stride+x,left=x>=channels?pixels[target-channels]:0,up=row?pixels[target-stride]:0,corner=row&&x>=channels?pixels[target-stride-channels]:0;const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);pixels[target]=(data[row*(stride+1)+1+x]+prediction)&255;}}
 return {width,height,pixelSha256:digest(pixels)};
}
const expected=new Set(['index.json','seal.json']);let pngCount=0;
for(const item of index.entries){
 assert.ok(item.path==='../../1839.md'||(!item.path.includes('..')&&!item.path.includes('/')&&!item.path.includes('\\')));
 const target=resolve(directory,item.path);const bytes=canonical(item.path,readFileSync(target));assert.equal(bytes.length,item.bytes,item.path);assert.equal(digest(bytes),item.sha256,item.path);
 if(item.path!=='../../1839.md')expected.add(item.path);
 if(item.path.endsWith('.png')){assert.deepEqual(png(bytes),item.png);pngCount++;}
 else{
  const text=bytes.toString('utf8');if(item.path.endsWith('.json'))JSON.parse(text);
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|"(?:password|access_token|refresh_token|sessionToken|cookies?)"\s*:\s*"[^\"]+"|(?:postgresql|redis):\/\/[^\s]+:[^\s]+@/i.test(text),`Private data pattern: ${item.path}`);
 }
}
assert.deepEqual(readdirSync(directory).sort(),[...expected].sort());
const cases=readJson('test-cases.json');assert.equal(cases.totalCases,318);assert.equal(cases.cases.length,318);assert.ok(cases.cases.every(x=>x.status==='passed'));assert.equal(new Set(cases.cases.map(x=>`${x.project}/${x.file}/${x.fullName}/${x.occurrence}`)).size,318);
const pins=readJson('source-pins.json');const git=(...args)=>execFileSync('git',args,{stdio:['ignore','pipe','pipe']});
for(const pin of pins.pins){for(const [commit,blob] of [[pins.base,pin.beforeBlob],[pins.implementation,pin.afterBlob]]){if(blob===null)continue;assert.equal(git('rev-parse',`${commit}:${pin.path}`).toString().trim(),blob);}if(pin.frozen)assert.equal(pin.beforeBlob,pin.afterBlob);}
for(const [file,commit] of [['before-settled-runtime.json',pins.base],['after-final-runtime.json',pins.implementation]]){const runtime=readJson(file);assert.equal(runtime.head,commit);assert.equal(runtime.captures.length,7);assert.equal(runtime.errors.length,0);for(const capture of runtime.captures){assert.equal(capture.heading.length,1);assert.ok(capture.fields.every(x=>x.empty));assert.equal(capture.width,capture.documentWidth);assert.equal(capture.challenge.ready,true);}
 for(const [path,hash] of Object.entries(runtime.sourceHashes)){const pin=pins.pins.find(x=>x.path===path);assert.ok(pin);if(hash===null){assert.equal(pin.beforeBlob,null);continue;}const body=git('show',`${commit}:${path}`);const crlf=Buffer.from(body.toString('utf8').replace(/\r?\n/g,'\r\n'));assert.ok(digest(body)===hash||digest(crlf)===hash,path);}
}
for(const sha of readJson('preservation.json').anchors)git('merge-base','--is-ancestor',sha,pins.implementation);
const cleanup=readJson('cleanup.json');assert.ok(cleanup.containers.every(x=>x.absent));assert.ok(cleanup.nextProcesses.every(x=>x.absent));assert.ok(cleanup.recordedCaptureBrowsers.every(x=>x.absent));assert.ok(cleanup.listenerAbsent&&cleanup.ownedProfilesAbsent);
if(process.argv.includes('--current-source'))for(const pin of pins.pins)assert.equal(digest(readFileSync(pin.path)),pin.physicalSha256,pin.path);
console.log(JSON.stringify({ok:true,files:index.entries.length,pngs:pngCount,cases:cases.totalCases,source:pins.implementation,privatePayloads:false}));
