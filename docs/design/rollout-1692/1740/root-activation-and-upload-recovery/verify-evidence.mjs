// Read-only publication verification. No archived module is imported or executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(base,'../../../../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(ok,label)=>{if(!ok)throw Error(label);};
const read=p=>fs.readFileSync(path.join(base,p));
const json=p=>JSON.parse(read(p).toString('utf8'));
const commands=[];
function git(args,input) {
  const r=spawnSync('git',['--no-optional-locks',...args],{cwd:root,input,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:8e6});
  commands.push({command:['git','--no-optional-locks',...args],exit:r.status});
  assert(r.status===0,'read-only Git failed');
  return r.stdout;
}
function files(dir,prefix='') {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const rel=prefix+e.name,full=path.join(dir,e.name);
    assert(!fs.lstatSync(full).isSymbolicLink(),'archive symlink forbidden');
    return e.isDirectory()?files(full,rel+'/'):(assert(e.isFile(),'ordinary archive files only'),[rel]);
  }).sort();
}
function safeRelative(p) {
  assert(typeof p==='string' && p!=='' && !path.isAbsolute(p) && !p.includes('\\') && !p.split('/').includes('..'),'bounded public path');
}
function inventory() {return files(base).map(p=>({path:p,bytes:read(p).length,sha256:hash(read(p))}));}
function verifyEntry(e,p=e.path) {
  safeRelative(p);const b=read(p);
  assert(b.length===e.bytes && hash(b)===e.sha256,`byte/hash mismatch: ${p}`);
}
function nativeSyntax(p) {
  const args=['--check','--input-type='+(/\.cjs$/.test(p)?'commonjs':'module')];
  const r=spawnSync(process.execPath,args,{input:read(p),encoding:'utf8',cwd:root});
  commands.push({command:['node',...args],inputArchivePath:p,exit:r.status,executed:false});
  assert(r.status===0,`syntax check failed: ${p}`);
}

// Complete accepted PNG decoding: signature, every CRC, zlib and scanline filters.
function crc32(b) {
  let crc=0xffffffff;
  for(const byte of b){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function decodePng(p) {
  const b=read(p);
  assert(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature');
  let at=8,header,ended=false,idatStarted=false,idatEnded=false,chunks=0;
  const compressed=[];
  while(at<b.length) {
    assert(at+12<=b.length,'PNG chunk bounds');
    const n=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8),end=at+12+n;
    assert(end<=b.length && /^[A-Za-z]{4}$/.test(type),'PNG chunk type/bounds');
    assert(crc32(b.subarray(at+4,at+8+n))===b.readUInt32BE(at+8+n),'PNG chunk CRC');
    const data=b.subarray(at+8,at+8+n);chunks++;
    if(type==='IHDR') {
      assert(!header && chunks===1 && n===13,'PNG IHDR order');
      header={width:data.readUInt32BE(0),height:data.readUInt32BE(4),depth:data[8],colorType:data[9],compression:data[10],filter:data[11],interlace:data[12]};
    } else {
      assert(header && !ended,'PNG chunk order');
      if(type==='IDAT') {assert(!idatEnded,'PNG contiguous IDAT');idatStarted=true;compressed.push(data);}
      else if(idatStarted) idatEnded=true;
      if(type==='IEND') {assert(n===0 && idatStarted && end===b.length,'PNG final IEND');ended=true;}
      if(type[0]===type[0].toUpperCase()) assert(['IDAT','IEND','PLTE'].includes(type),'PNG known critical chunk');
    }
    at=end;
  }
  assert(ended && header.width>0 && header.height>0 && header.depth===8 && [0,2,4,6].includes(header.colorType) && header.compression===0 && header.filter===0 && header.interlace===0,'supported complete PNG format');
  const channels=({0:1,2:3,4:2,6:4})[header.colorType];
  const stride=header.width*channels,expected=(stride+1)*header.height;
  assert(expected<100e6,'PNG bounded dimensions');
  const packed=Buffer.concat(compressed),inflated=inflateSync(packed,{info:true,maxOutputLength:expected+1});
  assert(inflated.buffer.length===expected && inflated.engine.bytesWritten===packed.length,'complete exact PNG inflate');
  const pixels=Buffer.alloc(stride*header.height),filters=new Set();
  for(let y=0;y<header.height;y++) {
    const row=y*(stride+1),filter=inflated.buffer[row];filters.add(filter);
    assert(filter<=4,'valid PNG scanline filter');
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,up=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
      let prediction=0;
      if(filter===1)prediction=a;
      if(filter===2)prediction=up;
      if(filter===3)prediction=Math.floor((a+up)/2);
      if(filter===4){const q=a+up-c,pa=Math.abs(q-a),pb=Math.abs(q-up),pc=Math.abs(q-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?up:c;}
      pixels[i]=(inflated.buffer[row+1+x]+prediction)&255;
    }
  }
  return {path:p,...header,chunks,crc:true,fullyDecoded:true,filters:[...filters].sort(),pixelsSha256:hash(pixels)};
}

function historicalPins(pins,commits) {
  for(const commit of commits) {
    assert(/^[a-f0-9]{40}$/.test(commit),'fixed historical SHA');
    const tree=git(['ls-tree','-r','--full-tree',commit,'--',...pins.map(p=>p.path)]).toString('utf8');
    const entries=new Map(tree.trim().split('\n').map(line=>{const [meta,p]=line.split('\t');return [p,meta.split(' ')[2]];}));
    assert(entries.size===17,'exact historical pin tree');
    for(const p of pins)assert(entries.get(p.path)===p.gitBlob,`historical Git identity: ${p.path}`);
  }
  const batch=git(['cat-file','--batch'],pins.map(p=>p.gitBlob).join('\n')+'\n');
  let at=0;
  for(const p of pins) {
    const nl=batch.indexOf(10,at);assert(nl>=at,'Git batch header');
    const [blob,type,size]=batch.toString('ascii',at,nl).split(' '),n=Number(size);
    assert(blob===p.gitBlob && type==='blob' && Number.isInteger(n),'Git batch identity');
    const b=batch.subarray(nl+1,nl+1+n);
    assert(b.length===n && hash(b)===p.blobSha256 && hash(b.toString('utf8').replace(/\r\n/g,'\n'))===p.canonicalSha256,'historical blob hash');
    const objectHash=crypto.createHash('sha1').update(Buffer.from(`blob ${n}\0`)).update(b).digest('hex');
    assert(objectHash===p.gitBlob && batch[nl+1+n]===10,'Git blob object hash');
    at=nl+2+n;
  }
  assert(at===batch.length,'exact Git batch consumed');
}

function scanSecrets(items) {
  // Report only file/rule/count, never the matched text. Placeholders are not credentials.
  const rules=[
    ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
    ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ['api-key',/\bsk-(?:proj-|live_|test_)?[A-Za-z0-9_-]{24,}\b/g],
    ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
    ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
    ['literal-bearer',/\bBearer\s+[A-Za-z0-9_.~-]{24,}/g],
    ['credential-url',/\b(?:postgres(?:ql)?|mysql|redis|https?):\/\/[^\s/:@]+:([^\s/@]+)@/g],
    ['literal-credential',/\b(?:password|client_secret|api_key|access_token|refresh_token|authorization)["']?\s*[:=]\s*(["'])([^"'\r\n]{8,})\1/gi],
  ];
  const findings=[];
  const placeholders=/^(?:\$\{[^}]+\}|\*+|<[^>]+>|redacted|REDACTED|synthetic[-\w]*|test[-\w]*|fixture[-\w]*|example[-\w]*)$/;
  for(const item of items)for(const [rule,re] of rules) {
    re.lastIndex=0;let count=0;
    for(const m of item.text.matchAll(re)) {
      const value=rule==='literal-credential'?m[2]:rule==='credential-url'?m[1]:null;
      if(value && placeholders.test(value))continue;
      count++;
    }
    if(count)findings.push({path:item.path,rule,count});
  }
  assert(findings.length===0,`secret-pattern findings (matches suppressed): ${JSON.stringify(findings)}`);
  return {files:items.length,rules:rules.map(r=>r[0]),findings:0,matchesPrinted:false,scope:'Exact public archive files and newly appended report bytes only; no private references followed. Pattern scan is not a guarantee of absence.'};
}

try {
  assert(process.argv.slice(2).every(a=>a==='--current-source') && process.argv.slice(2).length<=1,'usage: verify-evidence.mjs [--current-source]');
  const current=process.argv.includes('--current-source');
  const before=inventory(),control=json('publication-controls/publication.json'),prefix=json('publication-controls/prefix-receipt.json');
  const index=json('file-index.json'),seal=json('seal.json'),payload=json('payload-index.json'),pinDoc=json('source-config-pins.json');
  assert(control.verifiedCommit===null && control.readiness===null && pinDoc.verifiedCommit===null && prefix.verifiedCommit===null,'publication stays provisional');
  const exclusions=['file-index.json','SHA256SUMS.txt','seal.json'];
  assert(JSON.stringify(control.indexExcludes)===JSON.stringify(exclusions),'explicit index exclusions');
  assert(JSON.stringify(before.map(p=>p.path))===JSON.stringify([...index.entries.map(e=>e.path),...exclusions].sort()),'exact archive file set');
  assert(new Set(index.entries.map(e=>e.path)).size===index.entries.length,'unique file index');
  for(const e of index.entries)verifyEntry(e);
  verifyEntry(seal.fileIndex,'file-index.json');verifyEntry(seal.sha256sums,'SHA256SUMS.txt');
  assert(read('SHA256SUMS.txt').toString('utf8')===index.entries.map(e=>`${e.sha256}  ${e.path}\n`).join(''),'exact SHA256SUMS coverage');
  assert(seal.indexedFiles===index.entries.length && seal.totalArchiveFiles===before.length,'seal cardinality');
  assert(payload.count===117 && payload.entries.length===117 && payload.bytes===6716079 && payload.entries.reduce((n,p)=>n+p.bytes,0)===6716079,'exact payload cardinality/bytes');
  assert(new Set(payload.entries.map(p=>p.destination)).size===117,'unique payload destinations');
  for(const e of payload.entries){assert(!('source' in e),'no private plan source in public index');verifyEntry(e,e.destination);}
  assert(pinDoc.pins.length===17 && new Set(pinDoc.pins.map(p=>p.path)).size===17,'exact 17 source/config pins');
  assert(pinDoc.pins.filter(p=>p.kind==='source').length===11 && pinDoc.pins.filter(p=>p.kind==='configuration').length===6,'pin kinds');
  for(const p of pinDoc.pins)safeRelative(p.path);
  historicalPins(pinDoc.pins,[pinDoc.sourceCommit,pinDoc.frozenReview,pinDoc.rootAtPublication]);
  let currentPins=null;
  if(current) {
    const head=git(['rev-parse','HEAD']).toString().trim();
    const tree=git(['ls-tree','-r','--full-tree',head,'--',...pinDoc.pins.map(p=>p.path)]).toString('utf8');
    const blobs=new Map(tree.trim().split('\n').map(l=>{const [m,p]=l.split('\t');return [p,m.split(' ')[2]];}));
    assert(blobs.size===17,'current exact pin tree');
    for(const p of pinDoc.pins) {
      const b=fs.readFileSync(path.join(root,p.path));
      assert(b.length===p.bytes && hash(b)===p.sha256 && hash(b.toString('utf8').replace(/\r\n/g,'\n'))===p.canonicalSha256 && blobs.get(p.path)===p.gitBlob,`current pin mismatch: ${p.path}`);
    }
    currentPins={head,files:17,raw:true,canonical:true,gitBlobs:true};
  }
  const report=fs.readFileSync(path.join(root,control.report)),old=report.subarray(0,prefix.originalPrefix.bytes),append=report.subarray(prefix.originalPrefix.bytes);
  assert(old.length===32701 && hash(old)==='a7ce7ba93d9aa08229c183054deb34a7784dca2886b1018610fa202b0457cc14','immutable original report prefix');
  assert(hash(old)===prefix.originalPrefix.sha256 && append.length===prefix.append.bytes && hash(append)===prefix.append.sha256 && report.length===prefix.finalReport.bytes && hash(report)===prefix.finalReport.sha256,'report prefix/append/final hashes');
  assert(append.toString('utf8').startsWith('\n'+prefix.heading+'\n\n') && prefix.heading==='## Root bounded activation and upload recovery proof — 2026-11-17','exact appended heading');
  const jsonFiles=before.filter(p=>p.path.endsWith('.json')).map(p=>p.path);
  for(const p of jsonFiles)json(p);
  const syntax=json('syntax-checks.json'),scripts=before.filter(p=>/\.(?:cjs|mjs|js)$/.test(p.path));
  for(const s of scripts)nativeSyntax(s.path);
  const archivedCode=payload.entries.filter(p=>/\.(?:cjs|mjs|js|ts|tsx|mts|fragment)$/.test(p.destination));
  assert(syntax.entries.length===archivedCode.length && syntax.entries.length===40,'all copied syntax coverage');
  assert(new Set(syntax.entries.map(e=>e.path)).size===40,'unique syntax entries');
  for(const p of archivedCode){const e=syntax.entries.find(e=>e.path===p.destination);assert(e && e.sha256===p.sha256 && e.exit===0 && e.diagnostics===0 && e.executed===false,'syntax receipt exact bytes/pass/no execution');}
  const captures=json('archive/runtime-current/capture-pins.json'),intake=json('archive/intake/machine-audit.json');
  const pngFiles=before.filter(p=>p.path.endsWith('.png'));
  assert(pngFiles.length===6 && captures.length===6,'exact operational PNG count');
  const pngs=pngFiles.map(p=>{
    const d=decodePng(p.path),name=path.basename(p.path),capture=captures.find(c=>c.path===name),accepted=intake.validation.pngs.find(c=>c.path===name);
    assert(capture && capture.sha256===p.sha256 && capture.width===d.width && capture.height===d.height && accepted && accepted.pixelsSha256===d.pixelsSha256,'PNG capture and accepted decoded pixel pins');return d;
  });
  const links=[];
  for(const doc of [{path:'README.md',text:read('README.md').toString('utf8'),dir:base},{path:control.report+'#new-section',text:append.toString('utf8'),dir:path.dirname(path.join(root,control.report))}]) {
    for(const m of doc.text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const target=m[1];assert(!/^(?:[a-z]+:|\/\/|\/|\\)/i.test(target),'new links must be relative');
      const [pathname,anchor]=target.split('#');assert(!anchor,'new links have no unchecked anchor');
      const full=path.resolve(doc.dir,decodeURIComponent(pathname));
      assert(full.startsWith(base+path.sep) && fs.statSync(full).isFile(),'new link resolves within approved archive');
      links.push({from:doc.path,target});
    }
  }
  assert(links.length>40,'new Markdown links discovered');
  const secretScan=scanSecrets([...before.map(p=>({path:p.path,text:read(p.path).toString('utf8')})),{path:control.report+'#new-section',text:append.toString('utf8')}]);
  const after=inventory();assert(JSON.stringify(before)===JSON.stringify(after),'archive unchanged during read-only verification');
  assert(fs.readFileSync(path.join(root,control.report)).equals(report),'report unchanged during verification');
  console.log(JSON.stringify({pass:true,mode:current?'current-source':'historical',payload:{files:117,bytes:6716079},archive:{files:before.length,bytes:before.reduce((n,e)=>n+e.bytes,0),inventorySha256:hash(JSON.stringify(before)),indexedFiles:index.entries.length,exclusions},sourcePins:{files:17,historicalCommits:[pinDoc.sourceCommit,pinDoc.frozenReview,pinDoc.rootAtPublication],current:currentPins},report:{prefix:prefix.originalPrefix,append:prefix.append,final:prefix.finalReport},json:{files:jsonFiles.length,parsed:true},syntax:{freshNative:scripts.length,pinnedCopiedReceipts:40,tsTsxMtsFragmentReceipts:21,archivedExecuted:false},pngs,links:{count:links.length,entries:links},secretScan,stable:{archiveUnchanged:true,reportUnchanged:true},commands,readiness:null},null,2));
} catch(e) {console.error(JSON.stringify({pass:false,error:e.message,matchesPrinted:false}));process.exitCode=1;}
