#!/usr/bin/env node
// Read-only public archive verification. Never imports or runs an archived
// harness, starts a runtime, runs a test, writes evidence or discovers .tmp.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';

const SOURCE='87b431bd6116ab90aed9d822db835dc78107bffb';
const INCOMING='ae0755e8385206e84f98ac52b5d3a0fb7f030513';
const HISTORICAL='89fe7fd5b6c1cdd155f7b503fb5534a673a89d72';
const CORRECTION='d4455c7c2bfe4ebd8471e918f703db5c84defe3c';
const VERIFIED='8e3876c39725b7a8ef5218439766395401d64b80';
const SEALS={
  "source-pins.json": "0b77583150fa549e7754eb8595e1d5c77eaf4bca5e8e643e603f86e04c48bc30",
  "verification-manifest.json": "653185fdd0b3f784dde6a077d17d366c3436579782c9d442e86a1a504823e6f4",
  "evidence-index.json": "8d64b103516d1286a801bb74cbb15bbae58467004fad0d6b505a083a752c1715",
  "publication-exclusions.json": "fa0a9c2eb99c39bc5d2353b48579dd0fa739fa6d7788ead2eff75c1dd5e1f029",
  "README.md": "9d4aaf4d00ed37ea367e7570d99965c0cc563a2e39243a75afaeec6493d7ec35",
  ".gitattributes": "705fd4d6451a31d36b3df7de96f83f30ac976c9b4a6d1e51671d8e2f33e2d0da"
};
const RUNTIME_SEALS={
 'HANDOFF-runtime.md':'b39d7cafa8eb2307068d6b7c4d586c637f8dc10fd15608597b3f3c6010b038ec',
 'verification-manifest.json':'2134ab7fd695cf2d61358adff5ed269ea27a823dea2fbb43b79e33e6355e223d',
 'artifact-hashes.json':'33229c78cec57399806877fe17176b1b1872360830a1e9c50a774166cdfb1fbe',
 'public-allowlist.json':'a589691471e7fdcd3a0eaeebbece9302620a6145da291f064e0ea87abf8dd6d8'
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
function safe(p){
 assert.equal(typeof p,'string');
 assert.ok(p&&!isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p));
 assert.ok(p.split('/').every(x=>x&&x!=='.'&&x!=='..'));
 return p;
}
function publicFile(p){
 safe(p);const target=join(archive,p),item=lstatSync(target),rel=relative(realArchive,realpathSync(target));
 assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));
 assert.ok(item.isFile()&&!item.isSymbolicLink());return readFileSync(target);
}
assert.equal(Object.keys(SEALS).length,6,'Require six reviewed metadata seals');
for(const[p,digest]of Object.entries(SEALS))assert.equal(sha(publicFile(p)),digest,p);
const pins=parse(publicFile('source-pins.json')),manifest=parse(publicFile('verification-manifest.json'));
const index=parse(publicFile('evidence-index.json')),exclusions=parse(publicFile('publication-exclusions.json'));
assert.equal(pins.state,'SEALED_FIXED_GIT');assert.equal(manifest.state,'SEALED_PUBLIC');
assert.equal(pins.source,SOURCE);assert.equal(manifest.source,SOURCE);
assert.equal(index.schemaVersion,1);assert.equal(index.files.length,159);
assert.equal(index.digest,sha(JSON.stringify(index.files)));
const allowed=new Map(index.files.map(p=>[safe(p.path),p]));assert.equal(allowed.size,159);
assert.deepEqual(index.counts,{static:15,merger:15,runtime:129,total:159});
assert.equal(exclusions.policy,'category-only; no private filenames, sizes, hashes, or reads');
assert.equal(exclusions.rawEvidencePreserved,true);assert.equal(exclusions.categories.length,3);
assert.equal(decode(publicFile('.gitattributes')),'* -text\n');
const read=p=>{assert.ok(allowed.has(safe(p)),'Not public: '+p);return publicFile(p);};
const json=p=>parse(read(p)),text=p=>decode(read(p));
let pngCount=0,jsonCount=0;
for(const p of index.files){
 assert.match(p.path,/^(static|merger|runtime)\//);assert.ok(Number.isSafeInteger(p.bytes)&&p.bytes>=0);
 assert.match(p.sha256,/^[a-f0-9]{64}$/);const b=read(p.path);
 assert.equal(b.length,p.bytes,p.path);assert.equal(sha(b),p.sha256,p.path);
 if(p.path.endsWith('.json')){parse(b);jsonCount++;}
 if(p.path.endsWith('.png')){decodePng(b);pngCount++;}
}
assert.equal(pngCount,26);
for(const[p,digest]of Object.entries(RUNTIME_SEALS))assert.equal(sha(read('runtime/'+p)),digest,p);
const allow=json('runtime/public-allowlist.json'),runtime=json('runtime/verification-manifest.json');
const runtimeHashes=json('runtime/artifact-hashes.json');
assert.equal(allow.files.length,128);assert.equal(new Set(allow.files).size,128);
assert.deepEqual(index.files.filter(p=>p.path.startsWith('runtime/')).map(p=>p.path.slice(8)).sort(),
 [...allow.files,allow.hashIndex].sort());
assert.equal(runtimeHashes.files.length,128);assert.equal(runtimeHashes.selfExcluded,true);
assert.deepEqual(runtimeHashes.files.map(p=>p.file).sort(),[...allow.files].sort());
for(const p of runtimeHashes.files){const b=read('runtime/'+p.file);assert.equal(sha(b),p.sha256);assert.equal(b.length,p.bytes);}

const cache=new Map();
function git(args){const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,execFileSync('git',
 ['--no-optional-locks','-C',repo,...args],{maxBuffer:64*1024*1024,windowsHide:true}));return cache.get(key);}
const gt=args=>git(args).toString('utf8').trim(),blob=(ref,p)=>git(['show',ref+':'+safe(p)]);
assert.equal(gt(['rev-parse',SOURCE+'^{tree}']),pins.tree);
assert.equal(pins.tree,'ba5a7bec6d0fe7feaedcf7b2d93da359e3a41593');
assert.equal(gt(['rev-parse',INCOMING+'^{tree}']),'6889454bdba84c0e3a35184d6f89ba449ceece62');
assert.deepEqual(gt(['rev-list','--parents','-n','1',INCOMING]).split(' ').slice(1),
 [HISTORICAL,'e9b0b6afe62da10ac7ced65cc48cc54ed40983cf']);
assert.equal(gt(['rev-parse',CORRECTION+'^']),INCOMING);
assert.equal(gt(['rev-parse',SOURCE+'^']),pins.rootCorrectionIntegration);
assert.equal(gt(['rev-parse',pins.rootCorrectionIntegration+'^{tree}']),'ac549e6d43125d71ee0481ef5432aa451c05f62b');
assert.equal(gt(['diff','--name-only',CORRECTION,SOURCE,'--','apps','packages']),'');
assert.deepEqual(gt(['diff','--name-only',INCOMING,CORRECTION]).split(/\r?\n/),pins.rootChangedPaths);
assert.equal(pins.rootChangedPaths.length,2);assert.equal(pins.incomingPaths.length,9);
git(['merge-base','--is-ancestor',VERIFIED,SOURCE]);
assert.equal(pins.latestDirectlyVerified,VERIFIED);assert.equal(manifest.latestDirectlyVerified,VERIFIED);
assert.equal(pins.pins.length,17);
const end=json('runtime/source-end.json'),start=json('runtime/source-start-public.json');
assert.equal(end.head,SOURCE);assert.equal(start.head,SOURCE);
assert.deepEqual(start.pins,end.pins.map(({snapshot,...p})=>p));
for(const p of pins.pins){
 const b=blob(SOURCE,p.path),snapshot=read('runtime/'+p.snapshot);
 assert.equal(gt(['rev-parse',SOURCE+':'+p.path]),p.gitBlob);assert.equal(b.length,p.gitBytes);
 assert.equal(sha(b),p.gitSha256);assert.equal(sha(lf(b)),p.gitLfSha256);
 assert.equal(sha(snapshot),p.raw);assert.equal(sha(lf(snapshot)),p.lf);assert.equal(p.lf,p.gitLfSha256);
 if(flags.has('--current-source'))assert.equal(sha(lf(readFileSync(join(repo,p.path)))),p.lf,p.path);
}
assert.equal(end.configs.length,14);assert.deepEqual(start.manifests,end.manifests);
for(const p of end.configs){
 const snapshot=read('runtime/'+p.snapshot);assert.equal(sha(snapshot),p.raw);
 assert.equal(start.manifests[p.path],p.raw);
 if(!p.path.startsWith('node_modules/'))assert.equal(sha(lf(blob(SOURCE,p.path))),sha(lf(snapshot)),p.path);
 if(flags.has('--current-source'))assert.equal(sha(readFileSync(join(repo,p.path))),p.raw,p.path);
}
assert.equal(end.allSourcePinsRawUnchanged,true);assert.equal(end.dependencyTopologyUnchanged,true);
assert.deepEqual(start.dependencyRoots,end.dependencyRoots);assert.deepEqual(start.links,end.links);
assert.equal(end.dependencyRoots.length,3);assert.equal(end.links.length,158);
for(const p of [...end.dependencyRoots,...end.links]){
 safe(p.path);assert.ok(!relative(repo,p.realpath).startsWith('..'));
 if(flags.has('--current-source')){
  const target=join(repo,p.path),actual=lstatSync(target);
  assert.equal(actual.isSymbolicLink(),p.isSymbolicLink,p.path);
  assert.equal(realpathSync(target).toLowerCase(),p.realpath.toLowerCase(),p.path);
  assert.ok(Math.abs(actual.birthtimeMs-p.birthtimeMs)<2,p.path+' creation identity');
 }
}
const numericAncestors=start.ancestors.filter(p=>typeof p.issue==='number');
assert.equal(numericAncestors.length,54);
for(const p of start.ancestors){assert.equal(p.ancestor,true);git(['merge-base','--is-ancestor',p.sha,SOURCE]);}
assert.equal(end.all54VerifiedTicketAncestorsPreserved,true);assert.equal(end.allTrackedIndexEntriesUnchanged,true);
assert.equal(end.proof1730.length,201);assert.equal(end.corrections1730.length,8);
for(const p of end.proof1730){assert.equal(p.unchanged,true);assert.equal(gt(['rev-parse',SOURCE+':'+p.path]),p.gitBlob);
 assert.deepEqual(blob(SOURCE,p.path),blob(HISTORICAL,p.path));}
for(const p of end.corrections1730){assert.equal(p.unchanged,true);assert.deepEqual(blob(SOURCE,p.path),blob(HISTORICAL,p.path));}
function tree(ref){return new Map(git(['ls-tree','-r','-z',ref]).toString().split('\0').filter(Boolean).map(line=>{
 const tab=line.indexOf('\t');return[line.slice(tab+1),line.slice(0,tab)];}));}
const sourceTree=tree(SOURCE),historicalTree=tree(HISTORICAL);
const priorGroups=JSON.parse(blob(SOURCE,'docs/design/rollout-1692/1730/root-request-confirmations/support/prior-proof-groups.json'));
assert.deepEqual(priorGroups.groups.map(p=>p.trackedPaths),[152,163,203,211,266]);
for(const group of priorGroups.groups){
 const prefix=group.path+'/';const paths=[...sourceTree.keys()].filter(p=>p.startsWith(prefix));
 assert.equal(paths.length,group.trackedPaths,group.path);for(const p of paths)assert.equal(sourceTree.get(p),historicalTree.get(p),p);
}
const inventory=JSON.parse(blob(SOURCE,pins.routeInventory.path));
assert.equal(gt(['rev-parse',SOURCE+':'+pins.routeInventory.path]),pins.routeInventory.gitBlob);
assert.equal(inventory.aliases.length,19);assert.equal(inventory.persistent.length,153);
assert.equal([...sourceTree.keys()].filter(p=>/^apps\/webapp\/src\/app\//.test(p)&&p.endsWith('/page.tsx')).length,172);
for(const p of inventory.aliases){assert.deepEqual(blob(SOURCE,p.file),blob(inventory.initialDev,p.file));}
const control=pins.baselineControl;
assert.equal(sha(read(control.path)),control.sha256);
assert.equal(lf(read(control.path)),lf(blob(HISTORICAL,control.sourcePath)).replace(control.adaptation.from,control.adaptation.to));

function unit(p,expected){
 const r=json(p),files=[],cases=[];
 for(const file of r.testResults){
  const name=file.name.replaceAll('\\','/'),at=name.lastIndexOf('apps/webapp/');assert.ok(at>=0);
  const physical=name.slice(at),occurrences=new Map();files.push(physical);
  for(const c of file.assertionResults){const n=(occurrences.get(c.fullName)??0)+1;occurrences.set(c.fullName,n);
   cases.push({...c,key:physical+'\0'+c.fullName+'\0'+n});}
 }
 assert.equal(new Set(files).size,files.length);assert.equal(new Set(cases.map(c=>c.key)).size,cases.length);
 assert.deepEqual([r.numTotalTests,r.numPassedTests,r.numFailedTests,r.numPendingTests,files.length],expected);
 assert.equal(cases.length,r.numTotalTests);assert.equal(cases.filter(c=>c.status==='passed').length,r.numPassedTests);
 assert.equal(cases.filter(c=>c.status==='failed').length,r.numFailedTests);return{files,cases};
}
const units=unit('static/unit-final.json',[346,346,0,0,51]);
const red=unit('static/selection-red.json',[13,12,1,0,1]);unit('static/selection-green.json',[13,13,0,0,1]);
assert.equal(red.cases.filter(c=>c.status==='failed')[0].fullName,'releases capacity when selected documents leave the refreshed result');
for(const file of ['selection-probes.json','selection-probes-repeat.json'])unit('merger/'+file,[2,1,1,0,2]);
unit('merger/unit-expanded.json',[345,345,0,0,51]);
const pg=json('runtime/public-postgres-dedup.json');
assert.deepEqual([pg.source,pg.exit,pg.physicalFiles,pg.tests,pg.passed,pg.failed,pg.pending],[SOURCE,0,5,83,83,0,0]);
const pgFiles=pg.results.map(f=>'apps/webapp/'+f.file),pgCases=[];
for(const f of pg.results){assert.equal(f.status,'passed');for(const c of f.cases){assert.equal(c.status,'passed');
 pgCases.push('apps/webapp/'+f.file+'\0'+c.name+'\0'+c.occurrence);}}
assert.equal(new Set(pgFiles).size,5);assert.equal(pgCases.length,83);assert.equal(new Set(pgCases).size,83);
assert.equal(new Set([...units.files,...pgFiles]).size,56);
assert.equal(new Set([...units.cases.map(c=>c.key),...pgCases]).size,429);
const checks=json('static/checks.json');assert.equal(checks.source,CORRECTION);assert.equal(checks.finalUnit.exit,0);
assert.equal(checks.types.exit,0);assert.match(checks.types.provenance,/attests the real tool result, not a reconstructed raw shell record/);
assert.deepEqual([checks.quality.rootExplicitCrlf.exit,checks.quality.allLint.exit,checks.quality.allFormat.exit],[0,0,1]);
const format=text('static/biome-all-format.log');assert.match(format,/route-metadata\.test\.ts format/);
assert.match(format,/route-metadata\.ts format/);assert.match(format,/Found 2 errors/);
assert.match(text('static/biome-final.log'),/Checked 2 files/);assert.match(text('static/biome-all-lint.log'),/Checked 9 files/);
for(const pattern of [/next typegen/,/tsconfig\.typecheck\.json/,/tsconfig\.workflow-contracts\.json/,/tsconfig\.smoke\.json/,/Types generated successfully/])
 assert.match(text('static/typecheck-final.log'),pattern);
assert.deepEqual([checks.quality.doctor.files,checks.quality.doctor.errors,checks.quality.doctor.warnings],[9,0,1]);
assert.match(text('static/doctor-final.log'),/Scanned 9 files/);

// Observe real terminal contracts; partial completion is never called exit zero.
const commands=json('runtime/commands-and-attempts.json').commands;
const command=name=>{const c=commands.find(x=>x.entry===name);assert.ok(c,name);return c;};
for(const[file,entry,count,exit,passed]of [
 ['public-cap.json','cap.mjs',13,1,false],['public-actions.json','actions.mjs',8,1,false],
 ['public-recovery.json','recovery.mjs',2,0,true],['public-roles.json','roles.mjs',4,1,false],
 ['public-roles-continuation.json','roles-continuation.mjs',7,0,true],
 ['public-binary.json','binary.mjs',3,1,false],['public-binary-continuation.json','binary-continuation.mjs',7,0,true]]){
 const r=json('runtime/'+file);assert.equal(r.checks.length,count,file);assert.equal(command(entry).exit,exit,entry);
 if(passed){assert.equal(r.status,'passed');assert.equal(Object.hasOwn(r,'failure'),false);}else assert.ok(r.failure);
 verifyObservation(r.source);
}
const cap=json('runtime/public-cap.json');assert.equal(cap.confirmation500.ids.length,500);
assert.equal(new Set(cap.confirmation500.ids).size,500);assert.equal(cap.otherAtCap.disabled,'true');
assert.equal(cap.otherAfterRefresh.dataDisabled,false);assert.equal(cap.otherAfterRefresh.selected,'false');
assert.equal(json('runtime/restore-policy.json').status,'passed');assert.equal(command('restore-policy.mjs').exit,0);
const binary=json('runtime/public-binary-continuation.json');
assert.deepEqual(binary.objectBefore,{status:200,size:68,versionId:null});
assert.equal(binary.protectedBefore.status,200);assert.equal(binary.protectedAfter,404);assert.equal(binary.objectAfter.status,404);
assert.equal(binary.previewBefore.length,1);assert.equal(binary.previewBefore[0].size,0);assert.equal(binary.previewBefore[0].versionId,'null');
assert.deepEqual(binary.previewAfter,{versions:0,deleteMarkers:0});assert.equal(runtime.physical.previewBefore,0);
assert.equal(manifest.physical.existingPreviewDeletionPassed,false);assert.equal(manifest.physical.discrepancyPreserved,true);
assert.equal(json('runtime/public-roles-continuation.json').protected,404);
const applied=json('runtime/overlay-before.json'),restored=json('runtime/overlay-restored.json');
assert.equal(applied.rows.length,3);assert.equal(restored.rows.length,3);
assert.equal(applied.appliedWithOwnNextStopped,true);assert.equal(restored.restoredWithOwnNextStopped,true);assert.equal(restored.allByteExact,true);
for(const p of applied.rows){assert.equal(p.historicalPin,HISTORICAL);assert.equal(sha(blob(HISTORICAL,p.path)),p.rawHistorical);
 assert.equal(p.rawCurrent,end.pins.find(x=>x.path===p.path).raw);
 assert.equal(restored.rows.find(x=>x.path===p.path).restoredRaw,p.rawCurrent);}
function verifyObservation(r,historical=false){
 assert.equal(r.head,SOURCE);assert.equal(r.digest,sha(JSON.stringify(r.pins)));
 assert.equal(new Set(r.pins.map(p=>p.path)).size,r.pins.length);
 for(const p of r.pins){const old=historical&&json('runtime/overlay-before.json').rows.some(x=>x.path===p.path);
  assert.equal(sha(lf(blob(old?HISTORICAL:SOURCE,p.path))),p.lf,p.path);}
}
for(const file of ['public-native-current.json','public-native-before.json','public-native-restored-final.json']){
 const r=json('runtime/'+file);assert.equal(r.status,'passed');verifyObservation(r.source,file==='public-native-before.json');
 assert.deepEqual(r.auth,{exit:0,signIn:200,active:200});assert.equal(r.inspect.actualTargetName,'DueForDeletionList');
 assert.equal(r.inspect.code,0);assert.equal(r.close.code,0);assert.match(r.targetLine,/DueForDeletionList/);
 const responses=name=>r.next.observations.find(x=>x.name===name).response.result.content.filter(x=>x.type==='text').map(x=>JSON.parse(x.text));
 assert.deepEqual(responses('get_compilation_issues'),[{issues:[]}]);
 assert.deepEqual(responses('get_errors'),[{configErrors:[],sessionErrors:[]}]);
 assert.match(JSON.stringify(responses('get_page_metadata')),/\/en\/personnel-files\/due-for-deletion/);
}
assert.ok(json('runtime/public-native-restored.json').failure);assert.equal(command('native.mjs restored').exit,1);
const sessions=json('runtime/native-sessions-cleanup.json');assert.equal(sessions.sessions.length,4);assert.equal(sessions.ownActiveSessions,0);
for(const s of sessions.sessions){assert.equal(s.info.data.active,false);assert.equal(s.info.data.pid,null);}
const cleanup=json('runtime/cleanup.json');
assert.deepEqual([cleanup.exit,cleanup.containersRemaining,cleanup.nativeSessionsActive,cleanup.ownResourcesRemaining],[0,0,0,0]);
assert.equal(cleanup.fixtureAppPortListening,false);assert.equal(cleanup.containers.length,3);
for(const c of cleanup.containers)assert.equal(c.remaining,false);
for(const p of allow.files.filter(x=>/^next-stop-.*\.json$/.test(x))){
 const r=json('runtime/'+p);assert.equal(r.listenersRemaining,0);assert.equal(r.processesRemaining,0);
 assert.equal(r.port,cleanup.fixtureAppPort);assert.ok(r.stopped.length>0);
}
assert.equal(runtime.acceptedCaptures.length,25);assert.equal(runtime.diagnosticCaptures.length,1);
assert.equal(runtime.fresh.matched.statesPerSource,6);assert.equal(runtime.fresh.matched.scope.recordCount,522);
assert.equal(runtime.fresh.matched.scope.recordDigest,'7adbe19c6a134d50025ae3a2bbe9a47106f5149d9cd3454ad95ef1c44ea78587');
assert.match(text('runtime/compare.mjs'),/select id,employee_id,category,title,document_date::text from employee_document where organization_id=\$1 order by id/i);
assert.equal(command('compare.mjs current').exit,0);assert.equal(command('compare.mjs before').exit,0);
let captureRefs=0;
for(const p of allow.files.filter(x=>x.endsWith('.json'))){const r=json('runtime/'+p);
 for(const c of r.captures??[]){if(typeof c==='string')continue;assert.ok(allow.files.includes(c.file),'Unreleased capture ref');
  assert.equal(sha(read('runtime/'+c.file)),c.sha256);captureRefs++;}}
const rejected=command('private failure-image inspection');assert.equal(rejected.status,'rejected by automatic approval review');
assert.match(rejected.reason,/not read through another mechanism/);
assert.deepEqual([manifest.scope.wholeBranchVerified,manifest.scope.wholeBranchReviewComplete,manifest.scope.wholeAppReady],[false,false,false]);

const scripts=[...allowed.keys()].filter(p=>p.endsWith('.mjs'));
for(const p of scripts)execFileSync(process.execPath,['--check',join(archive,p)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
// Installed TS7 CJS is version-only; use existing Next's Babel parser.
const parser=createRequire(appRequire.resolve('next/package.json'))('@babel/parser');
const tsFiles=[...allowed.keys()].filter(p=>/\.tsx?$/.test(p));
for(const p of tsFiles)parser.parse(text(p),{sourceType:'module',plugins:['typescript','jsx']});
let snapshotScripts=0,snapshotTypeScript=0;
for(const p of [...end.pins,...end.configs]){
 if(!/\.(?:tsx?|mjs)$/.test(p.path))continue;
 parser.parse(text('runtime/'+p.snapshot),{sourceType:'module',plugins:['typescript','jsx']});
 snapshotScripts++;if(/\.tsx?$/.test(p.path))snapshotTypeScript++;
}
const psFiles=[...allowed.keys()].filter(p=>p.endsWith('.ps1'));
for(const p of psFiles){const quoted=join(archive,p).replaceAll("'","''");
 const code="$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$null,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|Out-String)}";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],
 {windowsHide:true,stdio:['ignore','pipe','pipe']});}
let links=0;
for(const p of ['README.md',...index.files.filter(x=>x.path.endsWith('.md')).map(x=>x.path)]){
 const body=p==='README.md'?decode(publicFile(p)):text(p);
 for(const match of body.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
  const target=match[1];if(/^(?:https?:|mailto:|#)/i.test(target))continue;
  const resolved=join(dirname(join(archive,p)),decodeURIComponent(target.split('#')[0]));
  assert.ok(!relative(realArchive,resolved).startsWith('..'));assert.ok(existsSync(resolved),'Broken link: '+target);links++;}}
console.log(JSON.stringify({status:'verified',source:SOURCE,currentSourceChecked:flags.has('--current-source'),publicArtifacts:159,
 jsonFiles:jsonCount,decodedPngs:pngCount,sourcePins:17,configSnapshots:14,unitCases:346,physicalUnitFiles:51,postgresCases:83,
 physicalPostgresFiles:5,distinctCases:429,distinctPhysicalFiles:56,verifiedTicketAncestors:54,preserved1730ProofFiles:201,
 preserved1730Corrections:8,dependencyParents:3,localDependencyLinks:158,routeTemplates:172,redirectAliases:19,
 syntaxCheckedScripts:scripts.length,syntaxParsedTypeScript:tsFiles.length+snapshotTypeScript,
 syntaxParsedSourceAndConfigSnapshots:snapshotScripts,syntaxParsedPowershell:psFiles.length,
 captureReferences:captureRefs,localProseLinks:links,terminalDriverExitsPreserved:true,previewDiscrepancyQualified:true,
 privateEvidenceRead:false,runtimeHarnessesExecuted:0,testsRerun:false,wholeBranchVerified:false}));

// Full PNG CRC, inflate and scanline reconstruction. No image is edited.
function decodePng(bytes){
 assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 let offset=8,header,ended=false,palette=false;const streams=[];
 while(offset<bytes.length){
  assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),end=offset+12+length;assert.ok(end<=bytes.length);
  const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);
  assert.equal(crc(bytes.subarray(offset+4,offset+8+length)),bytes.readUInt32BE(offset+8+length),'PNG CRC '+type);
  if(type==='IHDR'){assert.equal(header,undefined);assert.equal(length,13);header=Buffer.from(data);}
  if(type==='PLTE')palette=true;if(type==='IDAT')streams.push(data);
  if(type==='IEND'){assert.equal(length,0);ended=true;offset=end;break;}offset=end;
 }
 assert.ok(header&&ended&&streams.length);assert.equal(offset,bytes.length);
 const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],color=header[9],interlace=header[12];
 assert.ok(width>0&&height>0&&width*height<=100000000);assert.equal(header[10],0);assert.equal(header[11],0);
 assert.ok(interlace===0||interlace===1);const channels={0:1,2:3,3:1,4:2,6:4}[color];
 assert.ok(channels&&({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color].includes(depth)));
 if(color===3)assert.ok(palette);const raw=inflateSync(Buffer.concat(streams),{maxOutputLength:1024*1024*1024});
 let cursor=0;const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
 for(const[x,y,dx,dy]of passes){
  const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(!w||!h)continue;
  const stride=Math.ceil(w*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8));let prior=Buffer.alloc(stride);
  for(let row=0;row<h;row++){
   assert.ok(cursor+1+stride<=raw.length);const filter=raw[cursor++];assert.ok(filter<=4);
   const current=Buffer.from(raw.subarray(cursor,cursor+stride));cursor+=stride;
   for(let i=0;i<stride;i++){
    const a=i>=bpp?current[i-bpp]:0,b=prior[i],c=i>=bpp?prior[i-bpp]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
    const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
    current[i]=(current[i]+predictor)&255;
   }prior=current;
  }
 }assert.equal(cursor,raw.length);
}
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
