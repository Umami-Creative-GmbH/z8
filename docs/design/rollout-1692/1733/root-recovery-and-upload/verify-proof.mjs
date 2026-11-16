#!/usr/bin/env node
// Read-only publication verifier. Never imports or runs archived harnesses.
// No network, tests, fixtures, services, package installation, Git or file writes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';

const CANDIDATE='166975f3c981d7f1f8d9e51bbce09fbe63b32568';
const LAST_VERIFIED='7cfbab79e202fffc17661f8eaefb8e5cce958834';
const METADATA_SEALS=/* PUBLICATION_METADATA_SEALS */{
  "source-pins.json": "f86a7f788e185238748089d61e7b30c712393acde8d7a411c6998b9c6113dfe1",
  "verification-manifest.json": "f1772efedde8b3689bc03d326016847eee9530e4d33c6c42e785666d92bfbfb4",
  "evidence-index.json": "f69d671dbeb0b234a099602b89db6754df8508b8c386c7a91cf507173c591653",
  "publication-exclusions.json": "089d932636c70e3c1a2dae021bc7d9c69c4dded68e5898ab648cbe6525ac3004",
  "test-accounting.json": "e9dec20e8a9c4a6c32af5cb536261f3f9f7c479619eeab73da89d1dac0db3359",
  "doctor-attestations.json": "0ad71312821e914f015b8452108c27ae73549d213ac9e1364167da21aa8fd75f",
  "README.md": "7462f48998c400fbba43ecd8822377ba4b7fac1afcffcd17b994467d00aac9c7",
  ".gitattributes": "5b63c563486081f610740af084770282085845cc629d73d3119c7003d63c3814"
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const lf=b=>b.toString('utf8').replaceAll('\r\n','\n');
const decode=b=>b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8').replace(/^\uFEFF/,'');
const parse=b=>JSON.parse(decode(b));
const archive=dirname(fileURLToPath(import.meta.url)),realArchive=realpathSync(archive);
const current=process.argv.slice(2).includes('--current-source');
assert.ok(process.argv.slice(2).every(p=>p==='--current-source'),'Unknown flag');
let repo=archive;
while(!existsSync(join(repo,'pnpm-workspace.yaml'))){const parent=dirname(repo);assert.notEqual(parent,repo,'Repository not found');repo=parent;}
function safe(p){assert.equal(typeof p,'string');assert.ok(p&&!isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p));assert.ok(p.split('/').every(x=>x&&x!=='.'&&x!=='..'));return p;}
function read(p){safe(p);const path=join(archive,p),item=lstatSync(path),rel=relative(realArchive,realpathSync(path));assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));assert.ok(item.isFile()&&!item.isSymbolicLink(),p);return readFileSync(path);}
const json=p=>parse(read(p)),text=p=>decode(read(p));
function files(dir=archive,prefix=''){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{assert.ok(!entry.isSymbolicLink(),'Archive symlink');const path=prefix+entry.name;return entry.isDirectory()?files(join(dir,entry.name),path+'/'):[safe(path)];}).sort();}
assert.equal(Object.keys(METADATA_SEALS).length,8);
for(const[p,digest]of Object.entries(METADATA_SEALS))assert.equal(sha(read(p)),digest,p);
const index=json('evidence-index.json'),pins=json('source-pins.json'),manifest=json('verification-manifest.json');
const exclusions=json('publication-exclusions.json'),accounting=json('test-accounting.json');
assert.equal(index.files.length,266);assert.equal(index.digest,sha(JSON.stringify(index.files)));
assert.deepEqual(index.counts,{runtime:112,commandStop:24,uploadStop:71,static:59,total:266});
const allowed=new Map(index.files.map(p=>[safe(p.path),p]));assert.equal(allowed.size,index.files.length);
assert.equal(pins.candidate,CANDIDATE);assert.equal(manifest.candidate,CANDIDATE);assert.equal(manifest.verifiedCommit,null);assert.equal(pins.verifiedCommit,null);assert.equal(pins.lastVerified,LAST_VERIFIED);assert.equal(manifest.lastVerified,LAST_VERIFIED);
assert.equal(pins.tree,'02a53818fa6160423339a36e371c52630ca569cc');assert.equal(pins.applicationTree,'e47b421aaa5617f6c270e11b8859938204fde16b');
assert.equal(pins.source,'22ebe15b3a0e2d6067445d2ac26b6a4576545e9d');
assert.equal(pins.sourcePins.length,14);assert.equal(pins.configPins.length,36);assert.equal(pins.corrections.length,4);
assert.equal(pins.dependencyParents,3);assert.equal(pins.dependencyLinks,158);assert.equal(pins.verifiedAncestors.length,56);
assert.equal(pins.lockSha256.toLowerCase(),'2a254a9e5731e431b5032d1b918688f5663ce837b08207e147e1808a71bb3799');
assert.equal(text('.gitattributes'),'* -text whitespace=cr-at-eol\n*.log whitespace=cr-at-eol,-blank-at-eof,-blank-at-eol\n');
let byteCount=0,jsonCount=0,pngCount=0;
const dimensions=new Map();
for(const entry of index.files){assert.ok(/^(runtime|stops\/command|stops\/upload|static)\//.test(entry.path));assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0);assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(entry.provenance&&entry.classification);const b=read(entry.path);assert.equal(b.length,entry.bytes,entry.path);assert.equal(sha(b),entry.sha256,entry.path);byteCount+=b.length;if(entry.path.endsWith('.json')){parse(b);jsonCount++;}if(entry.path.endsWith('.png')){dimensions.set(entry.path,decodePng(b));pngCount++;}}
assert.equal(byteCount,index.totalBytes);assert.equal(pngCount,30);
for(const[prefix,expected,pinCount]of [['runtime',112,111],['stops/command',24,23],['stops/upload',71,70]]){
 const allow=json(prefix+'/public-allowlist.json'),hashes=json(prefix+'/artifact-hashes.json');
 assert.equal(allow.files.length,expected);assert.equal(new Set(allow.files).size,expected);assert.equal(hashes.files.length,pinCount);
 const names=hashes.files.map(p=>p.file??p.path);assert.deepEqual(names.toSorted(),allow.files.filter(p=>p!=='artifact-hashes.json').toSorted());
 assert.ok(hashes.excludesSelf===true||hashes.selfExcluded===true||hashes.selfHashExcluded===true);
 assert.deepEqual(index.files.filter(p=>p.path.startsWith(prefix+'/')).map(p=>p.path.slice(prefix.length+1)).toSorted(),allow.files.toSorted());
 for(const p of hashes.files){const path=prefix+'/'+safe(p.file??p.path),b=read(path);assert.equal(b.length,p.bytes,path);assert.equal(sha(b),p.sha256.toLowerCase(),path);}
 const placement=exclusions.allowlistPlacement.find(p=>p.archive===prefix);assert.ok(placement);assert.equal(placement.originalBase,allow.base);assert.equal(placement.allowlistedFiles,expected);
}
const runtime=json('runtime/verification-manifest.json');
assert.equal(runtime.candidate,CANDIDATE);assert.equal(runtime.verifiedCommit,null);assert.equal(runtime.lastVerified,LAST_VERIFIED);assert.equal(runtime.freshCases,62);assert.equal(runtime.freshPhysicalFiles,6);
for(const p of runtime.sourcePins){const recorded=pins.sourcePins.find(c=>c.path===p.path);assert.ok(recorded);assert.equal(recorded.rawSha256,p.rawSha256);assert.equal(recorded.lfSha256,p.lfSha256);assert.equal(recorded.gitBlob,p.gitBlob);}
if(current){
 for(const p of [...pins.sourcePins,...pins.configPins]){safe(p.path);const b=readFileSync(join(repo,p.path));assert.equal(b.length,p.bytes,p.path+' bytes');assert.equal(sha(b),p.rawSha256,p.path+' raw');assert.equal(sha(lf(b)),p.lfSha256,p.path+' canonical LF');}
 const prefix=pins.reportOriginalPrefix,report=readFileSync(join(repo,prefix.path));assert.equal(sha(report.subarray(0,prefix.bytes)),prefix.sha256,'Original report prefix changed');assert.equal(sha(lf(report.subarray(0,prefix.bytes))),prefix.canonicalLfSha256);assert.equal([...report.toString('utf8').matchAll(/^## Root integration verification and upload recovery\r?$/gm)].length,1);
}
function normalFile(path){const p=path.replaceAll('\\','/'),i=p.lastIndexOf('apps/webapp/');assert.ok(i>=0,path);return p.slice(i);}
function unit(path){const r=json(path),physicalFiles=[],cases=[];for(const f of r.testResults){const file=normalFile(f.name),seen=new Map();physicalFiles.push(file);for(const a of f.assertionResults){const occurrence=(seen.get(a.fullName)??0)+1;seen.set(a.fullName,occurrence);cases.push({file,fullName:a.fullName,title:a.title,ancestorTitles:a.ancestorTitles,occurrence,status:a.status});}}assert.equal(new Set(physicalFiles).size,physicalFiles.length);assert.equal(cases.length,r.numTotalTests);assert.equal(cases.filter(c=>c.status==='passed').length,r.numPassedTests);assert.equal(cases.filter(c=>c.status==='failed').length,r.numFailedTests);return{file:path,reported:{total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests},physicalFiles,cases};}
const root=unit('static/current/unit-final.json');assert.deepEqual(root,accounting.root);assert.deepEqual(root.reported,{total:460,passed:460,failed:0,pending:0});assert.equal(root.physicalFiles.length,65);
const fresh=json('runtime/public/test-accounting.json').fresh;assert.equal(fresh.multiset.length,62);assert.equal(new Set(fresh.multiset.map(c=>c.file)).size,6);assert.ok(fresh.multiset.every(c=>c.status==='passed'));
const key=c=>c.file+'\0'+c.fullName+'\0'+c.occurrence;
const pg=fresh.multiset.filter(c=>c.run==='postgres20').map(({run,...c})=>c),union=[...root.cases,...pg];assert.equal(pg.length,20);assert.equal(new Set(union.map(key)).size,480);assert.equal(new Set(union.map(c=>c.file)).size,66);assert.deepEqual(union,accounting.primary.cases);
const browser=fresh.multiset.filter(c=>c.run==='browser3');assert.equal(browser.length,3);assert.ok(browser.every(c=>root.cases.some(x=>key(x)===key(c))));
for(const h of accounting.historicalRuns)assert.deepEqual(unit(h.file),h);
assert.equal(unit('static/scope/unit-final.json').cases.length,452);assert.equal(unit('static/command/unit-final.json').cases.length,457);assert.equal(unit('static/upload-diagnosis/unit-final.json').cases.length,459);
for(const[p,passed,failed]of [['static/upload-diagnosis/browser-red-final.json',1,1],['static/upload-diagnosis/browser-green.json',2,0],['static/upload-diagnosis/previous-client-red.json',2,1],['static/upload-diagnosis/previous-client-green.json',3,0]])assert.deepEqual([unit(p).reported.passed,unit(p).reported.failed],[passed,failed]);
for(const[p,source]of [['static/scope/checks.json','3045b2565e1eee25c8f35ccba46ee72a3ad35df9'],['static/command/checks.json','15b00b502bc2a2fd7f556433ba52c2da9768ea37'],['static/upload-diagnosis/checks.json','c0480cfd33e579d807264ff4c2017a66b799ae36'],['static/current/checks.json','22ebe15b3a0e2d6067445d2ac26b6a4576545e9d']])assert.equal(json(p).source,source);
const checks=json('static/current/checks.json');assert.deepEqual([checks.final.cases,checks.final.files,checks.final.passed,checks.final.failed],[460,65,460,0]);assert.deepEqual([checks.types.typegen,checks.types.projects,checks.types.exit,checks.types.observedSession],[true,3,0,24481]);assert.deepEqual([checks.quality.newBrowserFormat100CrlfExit,checks.quality.hookFormat80CrlfExit,checks.quality.lint2Exit],[0,0,0]);
for(const pattern of [/next typegen/,/tsconfig\.typecheck\.json/,/tsconfig\.workflow-contracts\.json/,/tsconfig\.smoke\.json/,/Types generated successfully/])assert.match(text('static/current/typecheck.log'),pattern);
assert.equal(json('static/current/unit-command.json').exit,0);assert.equal(json('static/current/published-source.json').published,CANDIDATE);
assert.deepEqual([manifest.sourceChecks.defaultTimeoutMs,manifest.sourceChecks.explicitBrowserCasesTimeoutMs],[5000,15000]);
const doctor=json('doctor-attestations.json');assert.equal(doctor.records.length,5);
for(const d of doctor.records){const t=text(d.path);assert.match(t,/^\[SANITIZED PUBLIC CLONE:/);assert.match(t,/Full diagnostics written to \[private diagnostics path omitted\]/);assert.ok(!/Full diagnostics written to [A-Z]:/i.test(t));assert.equal(d.rawDoctorStdoutHashed,false);assert.equal(d.rawDiagnosticsFileRead,false);assert.equal(d.base,LAST_VERIFIED);assert.equal(d.redactions,1);}
const latestDoctor=doctor.records.find(d=>d.group==='current');assert.deepEqual([latestDoctor.files,latestDoctor.errors,latestDoctor.warnings,latestDoctor.exit],[9,0,3,0]);
assert.match(text('static/command/doctor-inline-finally.sanitized.log'),/React Compiler doesn't support this syntax/);
assert.equal(exclusions.rawEvidencePreserved,true);assert.equal(exclusions.originalArchivesNotMovedOrModified,true);

// Syntax checks compile text only. No archived script, test, or snippet runs.
const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const parser=createRequire(appRequire.resolve('next/package.json'))('@babel/parser');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const namedAsyncBodies=new Set(['runtime/public/harness/historical-journey.mjs','runtime/public/harness/matched-captures.mjs','runtime/public/harness/restored-current-journey.mjs']);
let modules=0,asyncBodies=0,typed=0,powershell=0;
for(const p of allowed.keys()){
 if(p.endsWith('.mjs')){const body=text(p);try{if(p.includes('/harness/commands/')||namedAsyncBodies.has(p)){new AsyncFunction(body);asyncBodies++;}else{parser.parse(body,{sourceType:'module',plugins:['topLevelAwait']});modules++;}}catch(error){throw new Error('Syntax check '+p+': '+error.message,{cause:error});}}
 if(/\.tsx?$/.test(p)){parser.parse(text(p),{sourceType:'module',plugins:['typescript','jsx']});typed++;}
 if(p.endsWith('.ps1')){const path=join(archive,p).replaceAll("'","''");const code="$parseErrors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+path+"',[ref]$null,[ref]$parseErrors)|Out-Null;if($parseErrors.Count){throw ($parseErrors|Out-String)}";execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});powershell++;}
}
let links=0;const broken=[];
for(const p of ['README.md',...allowed.keys()].filter(p=>p.endsWith('.md'))){for(const m of text(p).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){const target=m[1];if(/^(?:https?:|#)/i.test(target))continue;const resolved=resolve(archive,dirname(p),decodeURIComponent(target.split('#')[0]));const rel=relative(realArchive,resolved).replaceAll('\\','/');assert.ok(!isAbsolute(rel)&&!rel.startsWith('..'),'Link outside archive '+p+' '+target);if(existsSync(resolved))links++;else broken.push({file:p,target});}}
assert.deepEqual(broken,exclusions.relativeLinkExclusions,'Required public link missing');
// All publication files, including this verifier, have one outer self-excluded
// byte index. Its digest is also handed to the parent outside this archive.
const seal=json('publication-seal.json');assert.equal(seal.excludesSelf,true);assert.equal(seal.digest,sha(JSON.stringify(seal.files)));assert.equal(new Set(seal.files.map(p=>p.path)).size,seal.files.length);assert.deepEqual(files(),[...seal.files.map(p=>safe(p.path)),'publication-seal.json'].sort());
for(const p of seal.files){const b=read(p.path);assert.equal(b.length,p.bytes,p.path);assert.equal(sha(b),p.sha256,p.path);if(p.path.endsWith('.json'))parse(b);}
console.log(JSON.stringify({status:'verified',candidate:CANDIDATE,verifiedCommit:null,currentSourceChecked:current,payloadFiles:index.files.length,payloadBytes:byteCount,indexDigest:index.digest,originalRuntimeAllowlists:[112,24,71],originalRuntimeHashPins:[111,23,70],parsedPayloadJson:jsonCount,fullyDecodedPngs:pngCount,recordedSourcePins:pins.sourcePins.length,configurationPins:36,rootSelectedCases:460,rootSelectedFiles:65,canonicalPgCases:20,canonicalPgFiles:1,primarySelectionUnionCases:480,primarySelectionUnionFiles:66,independentCases:62,independentFiles:6,independentAdditive:false,syntaxParsedModules:modules,syntaxCompiledAsyncBodies:asyncBodies,syntaxParsedTypedFiles:typed,syntaxParsedPowershell:powershell,localMarkdownLinks:links,explicitLinkExclusions:broken.length,doctorCurrentErrors:0,doctorCurrentReviewedWarnings:3,formatterBoundariesAccepted:false,privateInputsRead:false,archivedHarnessesExecuted:0,applicationTestsRerun:0,servicesStarted:0,gitOperations:0,fileWrites:0,readinessAdvanced:false}));

// Complete PNG CRC/inflate/unfilter reconstruction, supporting Adam7 passes.
function decodePng(bytes){assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));let offset=8,header,ended=false,palette=false;const streams=[];while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),end=offset+12+length;assert.ok(end<=bytes.length);const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);assert.equal(crc(bytes.subarray(offset+4,offset+8+length)),bytes.readUInt32BE(offset+8+length),'PNG CRC '+type);if(type==='IHDR'){assert.equal(header,undefined);assert.equal(length,13);header=Buffer.from(data);}if(type==='PLTE')palette=true;if(type==='IDAT')streams.push(data);if(type==='IEND'){assert.equal(length,0);ended=true;offset=end;break;}offset=end;}assert.ok(header&&ended&&streams.length);assert.equal(offset,bytes.length);const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],color=header[9],interlace=header[12];assert.ok(width>0&&height>0&&width*height<=100000000);assert.equal(header[10],0);assert.equal(header[11],0);assert.ok(interlace===0||interlace===1);const channels={0:1,2:3,3:1,4:2,6:4}[color];assert.ok(channels&&({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color].includes(depth)));if(color===3)assert.ok(palette);const raw=inflateSync(Buffer.concat(streams),{maxOutputLength:1024*1024*1024});let cursor=0;const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];for(const[x,y,dx,dy]of passes){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(!w||!h)continue;const stride=Math.ceil(w*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8));let prior=Buffer.alloc(stride);for(let row=0;row<h;row++){assert.ok(cursor+1+stride<=raw.length);const filter=raw[cursor++];assert.ok(filter<=4);const current=Buffer.from(raw.subarray(cursor,cursor+stride));cursor+=stride;for(let i=0;i<stride;i++){const a=i>=bpp?current[i-bpp]:0,b=prior[i],c=i>=bpp?prior[i-bpp]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;current[i]=(current[i]+predictor)&255;}prior=current;}}assert.equal(cursor,raw.length);return{width,height};}
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
