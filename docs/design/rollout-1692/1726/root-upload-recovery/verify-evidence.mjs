import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const directory=new URL('.',import.meta.url), root=fileURLToPath(new URL('../../../../../',import.meta.url));
const json=async name=>JSON.parse((await readFile(new URL(name,directory),'utf8')).replace(/^\ufeff/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>bytes.toString('utf8').replaceAll('\r\n','\n');
const sharp=createRequire(new URL('../../../../../apps/webapp/package.json',import.meta.url))('sharp');
const quality=await json('quality.json');
assert.equal(quality.sourceCommit,'4cb26d6e0408c33ee8f89ded3fcd1f73a2976292');
for(const[path,pin]of Object.entries(quality.sourcePins)){
 const bytes=execFileSync('git',['show',quality.sourceCommit+':'+path],{cwd:root,maxBuffer:8*1024*1024});assert.equal(sha(bytes),pin,path);
 // Later page owners legitimately extend heading opt-ins. This test's pin is historical.
 if(process.argv.includes('--current-source')&&path.includes('/settings/work-balance/'))assert.equal(canonical(await readFile(root+path)),canonical(bytes),path);
}
const union=new Map();
for(const name of ['exact-unit.json','compatibility-unit.json','adversarial-unit.json']){
 const run=await json(name);assert.equal(run.numFailedTests,0);assert.equal(run.numPendingTests,0);
 for(const suite of run.testResults){const occurrences=new Map();for(const test of suite.assertionResults){assert.equal(test.status,'passed');const occurrence=occurrences.get(test.fullName)??0;occurrences.set(test.fullName,occurrence+1);union.set(suite.name.replaceAll('\\','/').toLowerCase()+'\0'+test.fullName+'\0'+occurrence,suite.name.replaceAll('\\','/').toLowerCase());}}
}
assert.equal(new Set(union.values()).size,107);assert.equal(union.size,1141);assert.equal(quality.units.uniqueTests,union.size);
assert.equal((await json('old-component-matrix.json')).numFailedTests,5);assert.equal((await json('old-component-matrix.json')).numPassedTests,4);
for(const[name,failed]of [['hidden-preview-red.json',1],['returned-preview-red.json',1],['commit-navigation-red.json',2],['cache-refresh-red.json',1]])assert.equal((await json(name)).numFailedTests,failed);
const doctor=await json('doctor-final.json');assert.equal(doctor.sourceRevision,quality.sourceCommit);assert.equal(doctor.summary.errorCount,0);assert.equal(doctor.summary.warningCount,3);assert.equal((await json('doctor.json')).summary.warningCount,4);assert.equal(quality.types.exitCode,0);
const before=await json('before.json'),after=await json('after.json'),overlay=await json('source-overlay.json');
assert.equal(before.failure,undefined);assert.equal(after.failure,undefined);assert.equal(before.sameInputRetained,true);assert.equal(before.baselinePendingLock,true);assert.equal(after.sameInputRetained,true);assert.equal(before.checks.length,4);assert.equal(after.checks.length,6);
assert.equal(after.captures.find(capture=>capture.name==='after-returned-dialog.png').fileDisabled,false);
assert.equal(before.source.sha256,overlay.before);assert.equal(after.source.sha256,overlay.after);
for(const[phase,run]of [['before',before],['after',after]])assert.equal(sha(Buffer.from(canonical(await readFile(new URL('upload-'+phase+'.tsx.txt',directory))))),run.source.canonicalSha256);
const upload='apps/webapp/src/components/settings/work-balance/opening-balance-upload-dialog.tsx';assert.equal(after.source.canonicalSha256,quality.sourcePins[upload]);
const released=run=>run.checks.find(check=>check.name==='released the produced preview without replacing its response');assert.equal(released(before).sha256,released(after).sha256);assert.equal(released(after).status,200);
assert.equal(after.readback.length,1);assert.equal(after.readback[0].minutes,150);assert.equal(after.readback[0].day,'2026-03-31');assert.equal(after.readback[0].cancelled,false);assert.equal(after.readback[0].reason,'R043 root lifecycle carry forward');
let accepted=0;
for(const run of [before,after]){
 assert.deepEqual(run.errors,[]);
 for(const capture of run.captures){const bytes=await readFile(new URL(capture.name,directory));assert.equal(sha(bytes),capture.png.sha256);const{info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,capture.png.width);assert.equal(info.height,capture.png.height);assert.equal(info.width,capture.viewport.width);assert.equal(info.height,capture.viewport.height);assert.equal(capture.documentWidth,capture.viewport.width);assert.deepEqual(capture.source,run.source);accepted++;}
 for(const probe of run.next){const payload=JSON.parse(probe.result.result.content.find(item=>item.type==='text').text);if(probe.name==='get_compilation_issues')assert.deepEqual(payload,{issues:[]});else{assert.deepEqual(payload.configErrors,[]);for(const session of payload.sessionErrors){assert.equal(session.buildError,null);for(const error of session.runtimeErrors){assert.equal(error.errorName,'AuthorizationError');assert.equal(error.message,'Equipment access is not available.');assert.ok(error.stack.some(frame=>frame.file.includes('my-equipment')));}}}}
}
assert.equal(accepted,7);
const native=await json('native-authenticated-tree.json');assert.equal(native.success,true);assert.equal(JSON.stringify(native).includes('WorkBalancesView'),false);assert.equal(quality.native.freshTargetTree,false);assert.ok((await json('native-authenticated-open.json')).data.url.includes('/sign-in'));
const cleanup=await json('cleanup.json');assert.equal(cleanup.ownedNextIdentityVerified,true);assert.equal(cleanup.ownedNextStopped,true);assert.equal(cleanup.portClosed,true);assert.equal(cleanup.remainingOwnedContainers,0);assert.equal(cleanup.ownedContainers,3);assert.equal(cleanup.nativeBrowserClosed,true);
let pngs=0,jsons=0,scripts=0;
for(const entry of await readdir(directory,{withFileTypes:true})){
 if(!entry.isFile())continue;const path=new URL(entry.name,directory);
 if(entry.name.endsWith('.png')){await sharp(await readFile(path)).raw().toBuffer();pngs++;}
 else if(entry.name.endsWith('.json')){JSON.parse((await readFile(path,'utf8')).replace(/^\ufeff/,''));jsons++;}
 else if(entry.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',fileURLToPath(path)],{stdio:'pipe'});scripts++;}
}
assert.equal(pngs,9);
console.log(JSON.stringify({passed:true,uniqueFiles:107,uniqueTests:1141,oldComponentFailedCases:5,acceptedCaptures:accepted,decodedPNGs:pngs,parsedJSON:jsons,syntaxCheckedScripts:scripts,nativeTarget:false,currentOwnedSource:process.argv.includes('--current-source')}));
