#!/usr/bin/env node
// Read-only archive verification. No archived harness imports or execution,
// application tests, services, tracked writes, Git index access or .tmp discovery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';

const SOURCE='571ef1fd32c720a62a838787f5f6f293d0e9da97';
const CORRECTION='72b34589cb1d2fbc32a186b42b05758b22ff39ee';
const INTEGRATION='25a23e58c0ca84e87ece89e8ac633b0a951bbb11';
const HISTORICAL='96e64b16a10c629cae6ec820b11862ac48511503';
const SEALS=/* METADATA_SEALS */{
  "source-pins.json": "2bcf7a6a6255dc7536b697090b9786c038e8e81999949b7641635fb420aa85ff",
  "verification-manifest.json": "136124e1b489ab5366ff5c7bd2d6a91a86064d2fc8d0e96405d4daadf03348fc",
  "evidence-index.json": "96baf335193baff563dcf6ee17ea08dfd166d2fee2a8b5cb8c140cdc4cfe2a35",
  "publication-exclusions.json": "c1bf4bbc7b3d25b4eaceb1f26a1bf1ca1e2a9abbdef5c4a94f846530771e05c1",
  "README.md": "851d23c4199490cbfaf147ccc869f08f58c8de280c1bfe812eda77bafec0a03f",
  ".gitattributes": "5b63c563486081f610740af084770282085845cc629d73d3119c7003d63c3814"
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const lf=b=>b.toString('utf8').replaceAll('\r\n','\n');
const decode=b=>b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8').replace(/^\uFEFF/,'');
const parse=b=>JSON.parse(decode(b));
const flags=new Set(process.argv.slice(2));
assert.ok([...flags].every(x=>x==='--current-source'),'Unknown flag');
const archive=dirname(fileURLToPath(import.meta.url));
let repo=archive;
while(!existsSync(join(repo,'.git'))){const parent=dirname(repo);assert.notEqual(parent,repo);repo=parent;}
const realArchive=realpathSync(archive);
function safe(p){assert.equal(typeof p,'string');assert.ok(p&&!isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p));assert.ok(p.split('/').every(x=>x&&x!=='.'&&x!=='..'));return p;}
function publicFile(p){safe(p);const target=join(archive,p),item=lstatSync(target),rel=relative(realArchive,realpathSync(target));assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));assert.ok(item.isFile()&&!item.isSymbolicLink());return readFileSync(target);}
assert.equal(Object.keys(SEALS).length,6);
for(const[p,digest]of Object.entries(SEALS))assert.equal(sha(publicFile(p)),digest,p);
const pins=parse(publicFile('source-pins.json')),manifest=parse(publicFile('verification-manifest.json'));
const index=parse(publicFile('evidence-index.json')),exclusions=parse(publicFile('publication-exclusions.json'));
assert.equal(pins.state,'SEALED_FIXED_GIT');assert.equal(manifest.state,'SEALED_PUBLIC');
assert.equal(pins.candidate,SOURCE);assert.equal(manifest.candidate,SOURCE);
assert.equal(pins.rootCorrection,CORRECTION);assert.equal(pins.rootCorrectionIntegration,INTEGRATION);
assert.deepEqual(index.counts,{static:14,merger:8,runtime:74,total:96});
assert.equal(index.files.length,96);assert.equal(index.digest,sha(JSON.stringify(index.files)));
const allowed=new Map(index.files.map(p=>[safe(p.path),p]));assert.equal(allowed.size,96);
const read=p=>{assert.ok(allowed.has(safe(p)),'Not public: '+p);return publicFile(p);};
const json=p=>parse(read(p)),text=p=>decode(read(p));
let pngCount=0,jsonCount=0,totalBytes=0;
const pngDimensions=new Map();
for(const p of index.files){assert.match(p.path,/^(static|merger|runtime)\//);assert.ok(Number.isSafeInteger(p.bytes)&&p.bytes>=0);assert.match(p.sha256,/^[a-f0-9]{64}$/);const b=read(p.path);assert.equal(b.length,p.bytes,p.path);assert.equal(sha(b),p.sha256,p.path);totalBytes+=b.length;if(p.path.endsWith('.json')){parse(b);jsonCount++;}if(p.path.endsWith('.png')){pngDimensions.set(p.path,decodePng(b));pngCount++;}}
assert.equal(totalBytes,index.totalBytes);assert.equal(pngCount,19);
assert.equal(exclusions.rawEvidencePreserved,true);assert.equal(exclusions.staticScan.accidentalValueMatches,0);
assert.match(text('static/doctor.sanitized.log'),/Full diagnostics written to \[private diagnostics path omitted\]/);
assert.match(allowed.get('static/doctor.sanitized.log').provenance,/sanitized-clone/);
assert.equal(decode(publicFile('.gitattributes')),'* -text whitespace=cr-at-eol\n*.log whitespace=cr-at-eol,-blank-at-eof,-blank-at-eol\n');
const allow=json('runtime/public-allowlist.json'),runtime=json('runtime/verification-manifest.json'),hashes=json('runtime/artifact-hashes.json');
assert.equal(allow.files.length,74);assert.equal(new Set(allow.files).size,74);assert.ok(allow.files.includes('artifact-hashes.json'));
assert.deepEqual(index.files.filter(p=>p.group==='runtime').map(p=>p.path.slice(8)).sort(),[...allow.files].sort());
assert.equal(hashes.files.length,73);assert.equal(hashes.selfHashExcluded,true);assert.equal(hashes.allowlistedFiles,74);
assert.deepEqual(hashes.files.map(p=>p.path).sort(),allow.files.filter(p=>p!=='artifact-hashes.json').sort());
for(const p of hashes.files){const b=read('runtime/'+p.path);assert.equal(b.length,p.bytes,p.path);assert.equal(sha(b),p.sha256,p.path);}

// The only Git operation is show against explicit immutable commit IDs.
const cache=new Map();
function gitShow(args){const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,execFileSync('git',['--no-optional-locks','-C',repo,'show',...args],{windowsHide:true,maxBuffer:64*1024*1024}));return cache.get(key);}
const blob=(ref,p)=>gitShow([ref+':'+safe(p)]);
for(const p of pins.commits){assert.match(p.head,/^[a-f0-9]{40}$/);const[head,tree,parents]=gitShow(['--no-patch','--format=%H%n%T%n%P',p.head]).toString().trim().split(/\r?\n/);assert.deepEqual({head,tree,parents:parents.split(' ')},p);}
assert.equal(pins.commits[0].tree,runtime.candidate.tree);
assert.deepEqual(gitShow(['--format=','--name-only',CORRECTION]).toString().trim().split(/\r?\n/).sort(),[...pins.rootChangedPaths].sort());
assert.equal(pins.rootChangedPaths.length,5);assert.equal(pins.pins.length,12);assert.equal(pins.configPins.length,36);
const runtimePins=json('runtime/public/source-pins.json');
assert.equal(runtimePins.head,SOURCE);assert.equal(runtimePins.allStartRestoredAndEndRawPinsEqual,true);
for(const p of pins.pins){const b=blob(SOURCE,p.path);assert.equal(b.length,p.gitBytes);assert.equal(sha(b),p.gitSha256,p.path);assert.equal(sha(lf(b)),p.gitLfSha256,p.path);assert.equal(p.lf,p.gitLfSha256);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex'),p.gitBlob);assert.ok(b.equals(blob(CORRECTION,p.path))&&b.equals(blob(INTEGRATION,p.path)),p.path);const recorded=runtimePins.pins.find(x=>x.path===p.path);assert.deepEqual(recorded,{path:p.path,raw:p.raw,lf:p.lf});if(flags.has('--current-source')){const current=readFileSync(join(repo,p.path));assert.equal(sha(current),p.raw,p.path+' raw');assert.equal(sha(lf(current)),p.lf,p.path+' LF');}}
for(const p of pins.configPins){const b=blob(SOURCE,p.path);assert.equal(b.length,p.gitBytes);assert.equal(sha(b),p.gitSha256,p.path);assert.equal(sha(lf(b)),p.gitLfSha256,p.path);if(flags.has('--current-source')){const current=readFileSync(join(repo,p.path));assert.equal(sha(current),p.runtimeRawSha256,p.path+' raw');assert.equal(sha(lf(current)),p.gitLfSha256,p.path+' LF');}}
const originalReport=blob(SOURCE,pins.reportPrefix.path);assert.equal(originalReport.length,pins.reportPrefix.gitBytes);assert.equal(sha(originalReport),pins.reportPrefix.gitSha256);assert.equal(sha(lf(originalReport)),pins.reportPrefix.canonicalLfSha256);
assert.deepEqual(runtimePins.dependencyParents.map(p=>p.physical),[true,true,true]);assert.equal(runtimePins.outerLinks,158);assert.equal(runtimePins.lock,'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');

function unit(p,expected){const r=json(p),files=[],cases=[];for(const file of r.testResults){const name=file.name.replaceAll('\\','/'),at=name.lastIndexOf('apps/webapp/');assert.ok(at>=0);const physical=name.slice(at),occurrences=new Map();files.push(physical);for(const c of file.assertionResults){const n=(occurrences.get(c.fullName)??0)+1;occurrences.set(c.fullName,n);cases.push({...c,key:physical+'\0'+c.fullName+'\0'+n});}}assert.equal(new Set(files).size,files.length);assert.equal(new Set(cases.map(c=>c.key)).size,cases.length);assert.deepEqual([r.numTotalTests,r.numPassedTests,r.numFailedTests,r.numPendingTests,files.length],expected,p);assert.equal(cases.length,r.numTotalTests);assert.equal(cases.filter(c=>c.status==='passed').length,r.numPassedTests);assert.equal(cases.filter(c=>c.status==='failed').length,r.numFailedTests);return{files,cases};}
const a=unit('static/unit-final.json',[408,408,0,0,58]),b=unit('static/unit-additional.json',[32,32,0,0,4]);
assert.equal(new Set([...a.files,...b.files]).size,62);assert.equal(new Set([...a.cases,...b.cases].map(c=>c.key)).size,440);
unit('static/heading-red.json',[1,0,1,0,1]);unit('static/heading-green.json',[1,1,0,0,1]);
unit('static/scope-red.json',[5,1,4,0,1]);unit('static/scope-green.json',[17,17,0,0,2]);unit('static/lifetime-green.json',[18,18,0,0,2]);
unit('merger/heading-probes.json',[2,1,1,0,2]);unit('merger/lifetime-probes.json',[4,3,1,0,1]);
const pg=json('runtime/public/postgres20.json');assert.deepEqual([pg.head,pg.physicalFiles,pg.distinctCases,pg.passed,pg.failed,pg.skipped,pg.exit],[SOURCE,1,20,20,0,0,0]);
assert.equal(pg.identities.length,20);const pgKeys=pg.identities.map(c=>{assert.equal(c.status,'passed');return'apps/webapp/'+c.physicalFile+'\0'+c.fullName+'\0'+c.occurrence;});
assert.equal(new Set(pgKeys).size,20);assert.equal(new Set([...a.files,...b.files,...pg.identities.map(c=>'apps/webapp/'+c.physicalFile)]).size,63);assert.equal(new Set([...a.cases,...b.cases].map(c=>c.key).concat(pgKeys)).size,460);
const checks=json('static/checks.json');assert.equal(checks.source,CORRECTION);assert.equal(checks.status,'source checks complete; fresh runtime pending');assert.equal(checks.finalUnit.defaultTimeoutMs,5000);assert.equal(checks.types.exit,0);assert.equal(checks.types.projects,3);assert.deepEqual([checks.quality.rootFormat.exit,checks.quality.all.lintExit,checks.quality.all.formatExit],[0,0,1]);assert.equal(checks.quality.all.formattingPaths.length,6);assert.deepEqual([checks.quality.doctor.files,checks.quality.doctor.errors,checks.quality.doctor.warnings],[10,0,2]);
assert.match(text('static/biome-root.log'),/Checked 3 files/);assert.match(text('static/biome-all-lint.log'),/Checked 10 files/);assert.match(text('static/biome-all-format.log'),/Found 6 errors/);
for(const pattern of [/next typegen/,/tsconfig\.typecheck\.json/,/tsconfig\.workflow-contracts\.json/,/tsconfig\.smoke\.json/,/Types generated successfully/])assert.match(text('static/typecheck-final.log'),pattern);
assert.match(blob(SOURCE,'apps/webapp/src/components/personnel-file/payslip-batch-start.test.tsx').toString(),/defaultPrevented/);
assert.match(blob(SOURCE,'apps/webapp/src/components/personnel-file/payslip-batch-start.test.tsx').toString(),/cancelable:\s*true/);
assert.equal(json('merger/handoff.json').status,'merged; NOT VERIFIED; root correction required');
assert.match(checks.redGreen.pendingControl.boundary,/locked/);

assert.equal(runtime.candidate.head,SOURCE);assert.equal(runtime.runtime.officerGrantAndHeldRevocationAccepted,false);assert.equal(runtime.runtime.actualActivityLiveABAMatrixAccepted,false);assert.equal(runtime.runtime.automatedCaseTotalsAdditive,false);assert.equal(runtime.cleanup.allOwnedResourcesRemaining,0);
const attempts=json('runtime/public/attempts.json');assert.equal(attempts.controller.completedCommandAttempts,14);assert.equal(attempts.controller.failedCommandAttempts,11);assert.equal(attempts.controller.exit,0);assert.equal(attempts.commands.filter(c=>c.status==='complete').length,14);assert.equal(attempts.commands.filter(c=>c.status==='failed').length,11);for(const c of attempts.commands.filter(c=>c.status==='failed')){assert.ok(c.error&&c.qualification);}
const observed=json('runtime/public/runtime-observations.json');assert.equal(observed.candidate,SOURCE);assert.equal(observed.streamedFallback.observed.h1.length,1);assert.equal(observed.streamedFallback.observed.start,0);assert.equal(observed.streamedFallback.observed.history,0);assert.deepEqual(observed.contextRecovery.requests.map(p=>[p.method,p.path,p.displayUserMatches,p.displayOrgMatches,p.failedByControlled503]),[['GET','/api/auth/context',true,true,true],['GET','/api/auth/context',true,true,false]]);assert.deepEqual(observed.startOperation.delta,{batches:1,files:0,documents:0,notifications:0});assert.equal(observed.startOperation.firstKnownPreDispatchAbort,true);assert.equal(observed.startOperation.heldRetryPosts,1);assert.deepEqual([observed.startOperation.batch.pay_period_year,observed.startOperation.batch.pay_period_month,observed.startOperation.batch.visibility],[2025,3,'hr_only']);assert.deepEqual(observed.historyRecovery.draft,{year:'2023',combos:['07','HR-only']});assert.deepEqual(observed.historyRecovery.delta,{batches:0,files:0,documents:0,notifications:0});assert.equal(observed.roleBoundary.grantAndHeldRevokeAccepted,false);assert.equal(observed.roleBoundary.actualSavedGrantFacts.length,0);assert.equal(observed.roleBoundary.independentManagerDenied,true);assert.equal(observed.roleBoundary.independentRestrictedDenied,true);assert.ok(observed.native.input.names.includes('PayslipBatchStart')&&observed.native.input.names.includes('PayslipBatchesScope'));assert.ok(observed.native.header.names.includes('SiteHeader'));assert.equal(observed.native.input.connected,true);assert.equal(observed.native.header.connected,true);assert.equal(observed.phoneReachability.lastWithinViewport,true);assert.equal(observed.phoneReachability.documentWidth,observed.phoneReachability.viewportWidth);assert.equal(observed.completedObservations.length,31);
const comparison=json('runtime/public/matched-comparison.json'),applied=json('runtime/public/overlay-apply.json'),restored=json('runtime/public/overlay-restore.json');
assert.equal(comparison.historicalRef,HISTORICAL);assert.equal(comparison.currentHead,SOURCE);assert.equal(comparison.partialApplication,true);assert.equal(comparison.exactBatchStateEqual,true);assert.equal(comparison.batchStateDigestBefore,comparison.batchStateDigestCurrent);assert.equal(comparison.pairs.length,3);assert.equal(comparison.history.rows.length,2);assert.deepEqual(observed.historyRecovery.history,comparison.history);assert.equal(applied.paths.length,3);assert.equal(restored.paths.length,3);
for(const p of applied.paths){assert.equal(sha(blob(HISTORICAL,p.path)),p.historicalRaw);assert.equal(sha(lf(blob(HISTORICAL,p.path))),p.historicalLf);assert.equal(p.originalRaw,pins.pins.find(x=>x.path===p.path).raw);assert.equal(restored.paths.find(x=>x.path===p.path).restoredRaw,p.originalRaw);}
const captures=json('runtime/public/captures.json');let captureRefs=0;
for(const[p,dimensions]of pngDimensions){const file=p.slice('runtime/public/'.length),capture=captures.captures.filter(c=>c.file===file).at(-1);assert.ok(capture,file);assert.equal(capture.sha256,allowed.get(p).sha256,file);assert.equal(capture.pixelInspected,true);assert.deepEqual([capture.viewport.width,capture.viewport.height],[dimensions.width,dimensions.height]);captureRefs++;}
for(const pair of comparison.pairs){const[before,current]=pair.map(file=>captures.captures.filter(c=>c.file===file).at(-1));assert.deepEqual(before.viewport,current.viewport);assert.equal(before.font,current.font);assert.equal(before.documentWidth,current.documentWidth);}
assert.deepEqual(runtime.runtime.nextFinalCompilation,{issues:[]});assert.deepEqual(runtime.runtime.nextFinalErrors,{configErrors:[],sessionErrors:[]});
const cleanup=json('runtime/public/cleanup.json');assert.equal(cleanup.ownedControllerClosed,true);assert.equal(cleanup.ownedNextTreesRemaining,0);assert.equal(cleanup.ownedListenerCount,0);assert.equal(cleanup.ownedBrowserPidRemaining,false);assert.equal(cleanup.containersRemaining,0);assert.equal(cleanup.containers.length,6);for(const c of cleanup.containers)assert.equal(c.remaining,false);

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const scripts=[...allowed.keys()].filter(p=>p.endsWith('.mjs'));assert.equal(scripts.length,33);
let asyncBodies=0,moduleScripts=0;
for(const p of scripts){if(p.startsWith('runtime/public/harness/commands/')){new AsyncFunction(text(p));asyncBodies++;}else{execFileSync(process.execPath,['--check',join(archive,p)],{windowsHide:true,stdio:['ignore','pipe','pipe']});moduleScripts++;}}
assert.equal(asyncBodies,26);assert.equal(moduleScripts,7);
const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const parser=createRequire(appRequire.resolve('next/package.json'))('@babel/parser');
const tsFiles=[...allowed.keys()].filter(p=>/\.tsx?$/.test(p));assert.equal(tsFiles.length,3);
for(const p of tsFiles)parser.parse(text(p),{sourceType:'module',plugins:['typescript','jsx']});
const psFiles=[...allowed.keys()].filter(p=>p.endsWith('.ps1'));assert.equal(psFiles.length,1);
for(const p of psFiles){const quoted=join(archive,p).replaceAll("'","''");const code="$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$null,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|Out-String)}";execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});}
let localLinks=0;
for(const match of decode(publicFile('README.md')).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){const target=match[1];if(/^(?:https?:|#)/.test(target))continue;const resolved=join(archive,decodeURIComponent(target.split('#')[0]));assert.ok(!relative(realArchive,resolved).startsWith('..'));assert.ok(existsSync(resolved),'Broken link: '+target);localLinks++;}
// The final outer seal includes this verifier and saved outputs; it has no
// recursive self hash. On repeat verification every listed byte is read only.
if(existsSync(join(archive,'publication-seal.json'))){const seal=parse(publicFile('publication-seal.json'));assert.equal(seal.digest,sha(JSON.stringify(seal.files)));assert.equal(seal.files.length,new Set(seal.files.map(p=>p.path)).size);for(const p of seal.files){const b=publicFile(p.path);assert.equal(b.length,p.bytes,p.path);assert.equal(sha(b),p.sha256,p.path);if(p.path.endsWith('.json'))parse(b);}}
console.log(JSON.stringify({status:'verified',source:SOURCE,currentSourceChecked:flags.has('--current-source'),publicArtifacts:96,artifactBytes:totalBytes,indexDigest:index.digest,jsonFiles:jsonCount,fullyDecodedPngs:pngCount,sourcePins:12,rootChangedPaths:5,configurationPins:36,unitCaseInstances:440,unitPhysicalFiles:62,postgresCaseInstances:20,postgresPhysicalFiles:1,distinctCaseInstances:460,distinctPhysicalFiles:63,syntaxCheckedModules:moduleScripts,syntaxParsedAsyncCommandBodies:asyncBodies,syntaxParsedPublicTsx:tsFiles.length,syntaxParsedPowershell:psFiles.length,captureReferences:captureRefs,localProseLinks:localLinks,completedCommandAttempts:14,failedCommandAttempts:11,formattingBoundariesUnpassed:6,doctorReviewedWarnings:2,officerGrantRevocationAccepted:false,privateInputsRead:false,archivedHarnessesExecuted:0,applicationTestsRerun:false,servicesStarted:0,trackedWrites:0,wholeRolloutVerified:false}));

// Full PNG CRC, inflate and scanline reconstruction, including Adam7.
function decodePng(bytes){assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));let offset=8,header,ended=false,palette=false;const streams=[];while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),end=offset+12+length;assert.ok(end<=bytes.length);const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);assert.equal(crc(bytes.subarray(offset+4,offset+8+length)),bytes.readUInt32BE(offset+8+length),'PNG CRC '+type);if(type==='IHDR'){assert.equal(header,undefined);assert.equal(length,13);header=Buffer.from(data);}if(type==='PLTE')palette=true;if(type==='IDAT')streams.push(data);if(type==='IEND'){assert.equal(length,0);ended=true;offset=end;break;}offset=end;}assert.ok(header&&ended&&streams.length);assert.equal(offset,bytes.length);const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],color=header[9],interlace=header[12];assert.ok(width>0&&height>0&&width*height<=100000000);assert.equal(header[10],0);assert.equal(header[11],0);assert.ok(interlace===0||interlace===1);const channels={0:1,2:3,3:1,4:2,6:4}[color];assert.ok(channels&&({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color].includes(depth)));if(color===3)assert.ok(palette);const raw=inflateSync(Buffer.concat(streams),{maxOutputLength:1024*1024*1024});let cursor=0;const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];for(const[x,y,dx,dy]of passes){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(!w||!h)continue;const stride=Math.ceil(w*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8));let prior=Buffer.alloc(stride);for(let row=0;row<h;row++){assert.ok(cursor+1+stride<=raw.length);const filter=raw[cursor++];assert.ok(filter<=4);const current=Buffer.from(raw.subarray(cursor,cursor+stride));cursor+=stride;for(let i=0;i<stride;i++){const a=i>=bpp?current[i-bpp]:0,b=prior[i],c=i>=bpp?prior[i-bpp]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;current[i]=(current[i]+predictor)&255;}prior=current;}}assert.equal(cursor,raw.length);return{width,height};}
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
