// Read-only historical evidence verifier. Never imports archived harnesses.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export const archive = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
export function check(ok, message) { if (!ok) throw Error(message); }
export function safeRelative(p) {
  check(typeof p==='string' && p.length>0 && !p.includes('\\') && !p.includes(':') && !path.posix.isAbsolute(p) && !p.split('/').some(x=>!x||x==='.'||x==='..'), 'unsafe path');
  return p;
}
export function noLinks(p) {
  const absolute=path.resolve(p); let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor=path.join(cursor,part);
    try {check(!fs.lstatSync(cursor).isSymbolicLink(),'symlink refused');}
    catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  return absolute;
}
export function read(p) {
  safeRelative(p); const absolute=noLinks(path.join(archive,p));
  check(absolute.startsWith(archive+path.sep),'archive path escape');
  check(fs.lstatSync(absolute).isFile(),'not a regular file');
  return fs.readFileSync(absolute);
}
export const json=p=>JSON.parse(read(p).toString('utf8'));
export function metrics(b) {
  const out={bytes:b.length,sha256:sha256(b),normalization:'exact-binary'};
  try {
    const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
    if(s.includes('\0')) return out;
    const lf=Buffer.from(s.replace(/\r\n/g,'\n'),'utf8');
    const crlf=Buffer.from(lf.toString('utf8').replace(/\n/g,'\r\n'),'utf8');
    return {...out,normalization:'valid-utf8-no-nul',lf:{bytes:lf.length,sha256:sha256(lf)},crlf:{bytes:crlf.length,sha256:sha256(crlf)}};
  } catch { return out; }
}
export function matches(b,m) {
  const actual={bytes:b.length,sha256:sha256(b)};
  return [m,...(m.normalization==='valid-utf8-no-nul'?[m.lf,m.crlf]:[])].some(x=>x&&x.bytes===actual.bytes&&x.sha256===actual.sha256);
}
function crc32(b) {
  let c=0xffffffff;
  for(const v of b) {c^=v;for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
export function decodePng(b) {
  check(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature');
  let offset=8,header=null,ended=false,idatEnded=false,chunkCount=0;const parts=[];
  while(offset<b.length) {
    check(offset+12<=b.length,'PNG truncated chunk');
    const n=b.readUInt32BE(offset);check(offset+12+n<=b.length,'PNG chunk overrun');
    const type=b.toString('ascii',offset+4,offset+8),data=b.subarray(offset+8,offset+8+n);
    check(crc32(b.subarray(offset+4,offset+8+n))===b.readUInt32BE(offset+8+n),'PNG CRC');
    check(chunkCount++>0||type==='IHDR','PNG first chunk');
    if(type==='IHDR'){check(!header&&n===13,'PNG IHDR');header={width:data.readUInt32BE(0),height:data.readUInt32BE(4),depth:data[8],color:data[9],compression:data[10],filter:data[11],interlace:data[12]};}
    else if(type==='IDAT'){check(!idatEnded,'PNG nonconsecutive IDAT');parts.push(data);}
    else {if(parts.length) idatEnded=true;check(type==='IEND'||type==='PLTE'||type[0]===type[0].toLowerCase(),'PNG unknown critical chunk');}
    offset+=12+n;
    if(type==='IEND'){check(n===0&&offset===b.length,'PNG IEND/trailing bytes');ended=true;break;}
  }
  check(ended&&header&&parts.length>0,'PNG incomplete');
  const {width,height,depth,color,compression,filter,interlace}=header;
  check(width>0&&height>0&&width*height<100_000_000&&depth===8&&[2,6].includes(color)&&compression===0&&filter===0&&interlace===0,'PNG unsupported pixel format');
  const channels=color===2?3:4,stride=width*channels;
  const raw=zlib.inflateSync(Buffer.concat(parts),{maxOutputLength:(stride+1)*height});
  check(raw.length===(stride+1)*height,'PNG inflated size');
  const pixels=Buffer.alloc(stride*height);const filters=[0,0,0,0,0];
  for(let y=0;y<height;y++) {
    const f=raw[y*(stride+1)];check(f<=4,'PNG filter');filters[f]++;
    for(let x=0;x<stride;x++) {
      const a=x>=channels?pixels[y*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;
      const p=a+up-c,pa=Math.abs(p-a),pb=Math.abs(p-up),pc=Math.abs(p-c);
      const predictor=f===0?0:f===1?a:f===2?up:f===3?Math.floor((a+up)/2):pa<=pb&&pa<=pc?a:pb<=pc?up:c;
      pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {...header,channels,chunkCount,crc:'all chunks checked',pixelBytes:pixels.length,pixelSha256:sha256(pixels),filters,rawSha256:sha256(b)};
}
export function listFiles(dir=archive,prefix='') {
  noLinks(dir); const out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    check(!e.isSymbolicLink(),'archive symlink'); const rel=prefix+e.name;
    if(e.isDirectory())out.push(...listFiles(path.join(dir,e.name),rel+'/'));
    else {check(e.isFile(),'archive nonregular entry');out.push(rel);}
  }
  return out.sort();
}
export function scan(files) {
  const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['aws-access-id',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],['jwt',/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g],['literal-credential',/\b(?:password|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[=:]\s*["'][A-Za-z0-9+/_=-]{16,}["']/gi]];
  const flags=[];let textFiles=0;
  for(const p of files){const b=read(p);if(metrics(b).normalization!=='valid-utf8-no-nul')continue;textFiles++;const s=b.toString('utf8');for(const [kind,re]of patterns){const count=[...s.matchAll(re)].length;if(count) flags.push({path:p,kind,count});}}
  return {scope:'only publication archive; patterns do not prove global absence',textFiles,flags};
}
export function newLinks() {
  const files=['README.md'];const links=[];
  for(const p of files)for(const m of read(p).toString('utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target=m[1].split('#')[0];check(!/^[a-z]+:/i.test(target),'new external link');
    if(!target)continue;const absolute=noLinks(path.resolve(archive,path.dirname(p),target));
    check(absolute.startsWith(archive+path.sep)&&fs.lstatSync(absolute).isFile(),'new link missing/escape');links.push({from:p,target});
  }
  return links;
}
export function verify(current=false) {
  const fileIndex=json('publication-file-index.json'),seal=json('publication-seal.json');
  check(matches(read('publication-file-index.json'),seal.fileIndex),'publication index seal');
  const excluded=['publication-file-index.json','publication-seal.json','verification-results.json'];
  check(JSON.stringify(fileIndex.excluded)===JSON.stringify(excluded),'seal exclusion recipe');
  const files=listFiles();const expected=[...fileIndex.files.map(f=>f.path),...excluded].sort();
  check(JSON.stringify(files)===JSON.stringify(expected),'unexpected/missing archive file');
  for(const f of fileIndex.files)check(matches(read(f.path),f),'publication file mismatch '+f.path);
  const payload=json('payload-index.json');let rawExact=0;
  for(const f of payload.files){const b=read(f.path);check(matches(b,f),'payload mismatch '+f.path);if(sha256(b)===f.sha256)rawExact++;}
  const recipes=[];
  for(const a of json('archive-index.json').archives) {
    const idx=json(a.index);check(matches(read(a.index),a.indexMetrics),'original index pin '+a.destination);
    check(idx.files.length===a.payloadCount,'payload count');
    for(const f of idx.files) {
      safeRelative(f.path);const p=payload.files.find(x=>x.path===a.destination+'/'+f.path);
      check(p&&p.sha256===f.sha256&&(f.bytes===undefined||p.bytes===f.bytes),'original payload pin');
    }
    let actual;
    if(a.recipe==='sha-space-path-LF')actual=sha256(idx.files.map(f=>f.sha256+'  '+f.path+'\n').join(''));
    else if(a.recipe==='path-TAB-bytes-TAB-sha-LF')actual=sha256(idx.files.map(f=>f.path+'\t'+f.bytes+'\t'+f.sha256+'\n').join(''));
    else if(a.recipe==='JSON.stringify(files)')actual=sha256(JSON.stringify(idx.files));
    else {
      check(a.recipe==='derived-safe-binding','unknown recipe');const binding=json(a.safeBinding);
      check(binding.originalSafeIndexRawSha256===a.indexMetrics.sha256&&binding.safeAllowlistSha256===a.indexMetrics.sha256,'safe index binding');
      check(/^[a-f0-9]{64}$/.test(binding.originalSealSha256),'original private seal digest');
      actual='safe-index-bound; original private inventory deliberately uninspected';
    }
    if(a.recipe!=='derived-safe-binding')check(actual===a.sealSha256&&actual===(idx.sealSha256||idx.filesSealSha256),'original seal mismatch '+a.destination);
    recipes.push({destination:a.destination,count:idx.files.length,recipe:a.recipe,seal:actual});
  }
  const joint=json('joint/current/seal.json'),jointIndex=json('joint/current/safe-allowlist.json');
  check(joint.safeAllowlistSha256===payload.files.find(f=>f.path==='joint/current/safe-allowlist.json').sha256&&joint.filesSealSha256===sha256(JSON.stringify(jointIndex.files)),'joint scalar seal');
  const pins=json('source-config-pins.json');
  const repo=execFileSync('git',['-C',archive,'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true}).trim();
  const git=args=>execFileSync('git',['-C',repo,...args],{windowsHide:true,maxBuffer:8*1024*1024});
  let currentChecked=0;
  for(const p of pins.files) {
    safeRelative(p.path);
    check(git(['rev-parse',pins.sourceCommit+':'+p.path]).toString().trim()===p.gitBlob,'historical blob id '+p.path);
    const b=git(['cat-file','blob',p.gitBlob]);check(b.length===p.gitBytes&&sha256(b)===p.gitSha256,'historical blob hash');
    if(current&&p.currentSourceCheck) {
      const currentFile=noLinks(path.join(repo,p.path));check(fs.lstatSync(currentFile).isFile(),'current pin nonregular');
      const now=fs.readFileSync(currentFile);
      check((now.length===p.workingBytes&&sha256(now)===p.workingSha256)||matches(now,metrics(b)),'current source mismatch '+p.path);currentChecked++;
    }
  }
  const parsed=[],stdout=[],pngs=[];
  for(const f of payload.files) {
    if(f.path.endsWith('.json')){JSON.parse(read(f.path).toString('utf8'));parsed.push(f.path);}
    else if(/\.(log|txt)$/.test(f.path))stdout.push({path:f.path,kind:'historical text / command stdout; not asserted to be JSON'});
    if(f.path.endsWith('.png'))pngs.push({path:f.path,...decodePng(read(f.path))});
  }
  // Validate generated JSON too, including the explicitly self-excluded receipt.
  for(const p of files.filter(p=>p.endsWith('.json')))json(p);
  return {status:'PASS',mode:current?'current-source':'historical',sourceCommit:pins.sourceCommit,appTreeProvenance:pins.appTree,appTreeComparedToCurrent:false,publicationFiles:files.length,payloadFiles:payload.files.length,workingRawExactCopies:rawExact,normalizationPolicy:'raw or explicit LF/CRLF only for fatal-decoded UTF8 without NUL; binary exact',historicalGitPins:pins.files.length,currentSourcePins:currentChecked,recipes,parsedPayloadJson:parsed.length,historicalTextOutputs:stdout,pngs,newLinks:newLinks(),secretScan:scan(files),verifiedCommit1738:null,verifiedCommit1739:null,readOnly:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {check(process.argv.slice(2).every(x=>x==='--current-source')&&process.argv.slice(2).length<=1,'usage: node verify-evidence.mjs [--current-source]');console.log(JSON.stringify(verify(process.argv.includes('--current-source')),null,2));}
  catch(e){console.error(JSON.stringify({status:'FAIL',message:e.message}));process.exitCode=1;}
}
