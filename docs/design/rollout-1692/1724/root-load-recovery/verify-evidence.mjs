import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'../../../../..');
const sharp=createRequire(join(root,'apps/webapp/package.json'))('sharp');
const json=async name=>JSON.parse((await readFile(join(directory,name),'utf8')).replace(/^\ufeff/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>bytes.toString('utf8').replace(/\r\n/g,'\n');
const quality=await json('quality.json');
for(const[path,expected]of Object.entries(quality.sourcePins)){
 const captured=execFileSync('git',['show',quality.correctionCommit+':'+path],{cwd:root,maxBuffer:8*1024*1024});assert.equal(hash(captured),expected,path+' historical pin');
 if(process.argv.includes('--current-source'))assert.equal(canonical(await readFile(join(root,path))),canonical(captured),path+' current source');
}
const unit=await json('compatibility.json'),pg=await json('postgres.json'),client=await json('client-final.json');
assert.equal(unit.testResults.length,50);assert.equal(unit.numPassedTests,576);assert.equal(unit.numFailedTests,0);assert.equal(client.numPassedTests,37);assert.equal(pg.numPassedTests,18);assert.equal(pg.numFailedTests,0);
assert.equal((await json('lifecycle-red.json')).numFailedTests,2);assert.equal((await json('old-cleanup-red.json')).numFailedTests,1);
const comparison=await json('comparison-source.json');let accepted=0;
for(const phase of ['before','after']){
 const result=await json(phase+'.json');assert.equal(result.failure,undefined);assert.equal(result.cachedBranchRestored,true);assert.equal(result.pageErrors.length,0);assert.equal(result.checks.length,phase==='before'?6:7);
 assert.ok(result.requests.some(request=>request.functionName==='getOrgExplorerPeople'));
 for(const capture of result.captures){
  const bytes=await readFile(join(directory,capture.name));assert.equal(hash(bytes),capture.sha256);const info=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.info.width,capture.png.width);assert.equal(info.info.height,capture.png.height);assert.equal(capture.css.width,capture.png.width);assert.equal(capture.css.height,capture.png.height);assert.equal(capture.fonts,'loaded');
  for(const pin of comparison.files)assert.equal(capture.sources[pin.path],phase==='before'?pin.beforeSha256:pin.afterSha256);
  accepted++;
 }
 for(const probe of result.next){const content=probe.result.result.content.find(item=>item.type==='text');assert.deepEqual(JSON.parse(content.text),probe.name==='get_errors'?{configErrors:[],sessionErrors:[]}:{issues:[]});}
}
assert.equal(accepted,7);
const cleanup=await json('cleanup.json');assert.equal(cleanup.ownedNextIdentityVerified,true);assert.equal(cleanup.ownedNextStopped,true);assert.equal(cleanup.remainingOwnedContainers,0);assert.equal(cleanup.portClosed,true);
let decoded=0,parsed=0,syntax=0;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.png')){await sharp(await readFile(path)).raw().toBuffer();decoded++;}else if(entry.name.endsWith('.json')){JSON.parse((await readFile(path,'utf8')).replace(/^\ufeff/,''));parsed++;}else if(entry.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',path],{stdio:'pipe'});syntax++;}}}
await walk(directory);assert.equal(decoded,9);
console.log(JSON.stringify({passed:true,acceptedCaptures:accepted,decodedPNGs:decoded,parsedJSON:parsed,syntaxCheckedScripts:syntax,units:{files:50,tests:576},postgres:{files:1,tests:18},currentSource:process.argv.includes('--current-source')}));
