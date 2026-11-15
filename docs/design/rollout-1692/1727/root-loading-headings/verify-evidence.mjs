import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const directory=new URL('.',import.meta.url),root=fileURLToPath(new URL('../../../../../',import.meta.url));
const json=async name=>JSON.parse((await readFile(new URL(name,directory),'utf8')).replace(/^\ufeff/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>bytes.toString('utf8').replaceAll('\r\n','\n');
const sharp=createRequire(new URL('../../../../../apps/webapp/package.json',import.meta.url))('sharp');
const q=await json('quality.json');assert.equal(q.sourceCommit,'b4cef3a126fd16563cb0bbddfd5872a2aeb4e530');
for(const[path,pin]of Object.entries(q.sourcePins)){
 const bytes=execFileSync('git',['show',q.sourceCommit+':'+path],{cwd:root,maxBuffer:8*1024*1024});assert.equal(sha(bytes),pin,path);
 // Future route adoption may legitimately extend the directory's independent heading assertion.
 if(process.argv.includes('--current-source')&&!path.endsWith('/work-balances/page.test.tsx'))assert.equal(canonical(await readFile(root+path)),canonical(bytes),path);
}
const union=new Map();
for(const name of ['exact-unit.json','compatibility-unit.json','adversarial-unit.json']){
 const run=await json(name);assert.equal(run.numFailedTests,0);assert.equal(run.numPendingTests,0);
 for(const suite of run.testResults){const seen=new Map();for(const t of suite.assertionResults){assert.equal(t.status,'passed');const occurrence=seen.get(t.fullName)||0;seen.set(t.fullName,occurrence+1);const file=suite.name.replaceAll('\\','/').toLowerCase();union.set(file+'\0'+t.fullName+'\0'+occurrence,file);}}
}
assert.equal(new Set(union.values()).size,116);assert.equal(union.size,1213);
assert.equal((await json('old-consumers-matrix.json')).numFailedTests,4);assert.equal((await json('old-consumers-matrix.json')).numPassedTests,13);
assert.equal((await json('fallback-red.json')).numFailedTests,1);assert.equal((await json('scope-heading-red.json')).numFailedTests,3);assert.equal((await json('headings-green.json')).numPassedTests,17);
const doctor=await json('doctor.json');assert.equal(doctor.sourceRevision,q.provisionalMerge);assert.equal(doctor.summary.errorCount,0);assert.equal(doctor.summary.warningCount,1);assert.equal(doctor.projects[0].scannedFileCount,17);
const before=await json('before.json'),after=await json('after.json'),overlay=await json('source-overlay.json');
assert.deepEqual(before.checks[0].headings,[]);assert.deepEqual(after.checks[0].headings,['Work balance']);assert.deepEqual(before.checks[1].headings,after.checks[1].headings);assert.deepEqual(after.checks[1].headings,['Fixture Person 7']);
let captures=0;
for(const[phase,run]of [['before',before],['after',after]]){
 assert.equal(run.failure,undefined);assert.equal(run.checks.length,2);assert.equal(run.checks[0].heldDatabaseReads,1);assert.equal(run.abortedSpeculativePrefetch,0);assert.deepEqual(run.errors,[]);
 for(const[index,pin]of run.source.entries()){
  if(index<2){const bytes=await readFile(new URL(phase+'-'+index+'.tsx.txt',directory));assert.equal(sha(bytes),pin.sha256);assert.equal(sha(canonical(bytes)),pin.canonicalSha256);assert.equal(pin.sha256,overlay.pins[index][phase]);}
  if(phase==='after'||index===2)assert.equal(pin.canonicalSha256,q.sourcePins[pin.path],pin.path);
 }
 for(const capture of run.captures){const bytes=await readFile(new URL(capture.name,directory));assert.equal(sha(bytes),capture.png.sha256);const{info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1600);assert.equal(info.height,1000);assert.equal(info.width,capture.png.width);assert.equal(info.height,capture.png.height);assert.equal(capture.documentWidth,1600);assert.equal(capture.font,'16px');assert.deepEqual(capture.source,run.source);captures++;}
 for(const probe of run.next){const p=JSON.parse(probe.result.result.content.find(c=>c.type==='text').text);if(probe.name==='get_compilation_issues')assert.deepEqual(p,{issues:[]});else assert.deepEqual(p,{configErrors:[],sessionErrors:[]});}
}
assert.equal(captures,4);
const auth=await json('native-auth-status.json');assert.deepEqual(auth,{code:0,signIn:200,active:200});
const opened=await json('native-target-open.json');assert.equal(opened.code,0);assert.ok(JSON.parse(opened.out).data.url.includes('/payroll/work-balances/'));assert.ok(!JSON.parse(opened.out).data.url.includes('/sign-in'));
const native=await json('native-tree.json');assert.equal(native.code,0);assert.equal(JSON.parse(native.out).success,true);assert.ok(native.out.includes('EmployeeBalanceWorkspace'));assert.ok(native.out.includes('EmployeeBalanceArrival'));
const nativeSource=await json('native-source.json');assert.equal(nativeSource.head,q.provisionalMerge);for(const pin of nativeSource.source)assert.equal(pin.canonicalSha256,q.sourcePins[pin.path]);assert.equal((await json('native-close.json')).code,0);
const repair=await json('dependency-rebuild.json');assert.equal(repair.installExitCode,0);assert.equal(repair.scriptExecutionDisabled,true);assert.equal(repair.directJunctionCount,158);assert.equal(repair.externalDirectTargets,0);
const links=await json('dependency-restored-links.json');assert.equal(links.length,158);for(const link of links){const normalized=link.target.replaceAll('\\','/').toLowerCase();assert.ok(normalized.startsWith(root.replaceAll('\\','/').toLowerCase()));}
const cleanup=await json('cleanup.json');for(const key of ['portClosed','diagnosticReadLocksReleased','puppetBrowsersClosed','ownedNextStopped','nativeBrowserClosed','ownedNextIdentityVerified'])assert.equal(cleanup[key],true,key);assert.equal(cleanup.remainingOwnedContainers,0);assert.equal(cleanup.ownedContainers,3);
let pngs=0,jsons=0,scripts=0;
for(const entry of await readdir(directory,{withFileTypes:true})){if(!entry.isFile())continue;const path=new URL(entry.name,directory);if(entry.name.endsWith('.png')){await sharp(await readFile(path)).raw().toBuffer();pngs++;}else if(entry.name.endsWith('.json')){await json(entry.name);jsons++;}else if(entry.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',fileURLToPath(path)],{stdio:'pipe'});scripts++;}}
assert.equal(pngs,4);
console.log(JSON.stringify({passed:true,uniqueFiles:116,uniqueTests:1213,oldConsumerFailures:4,decodedPNGs:pngs,parsedJSON:jsons,syntaxCheckedScripts:scripts,nativeLoadedTarget:true,currentOwnedSource:process.argv.includes('--current-source')}));
