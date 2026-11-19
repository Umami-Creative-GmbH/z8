import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const repo=process.cwd(),out=resolve('docs/design/rollout-1692/1730'),require=createRequire(join(repo,'apps/webapp/package.json')),sharp=require('sharp');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,'')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedDiff:execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim(),jsonFiles:0,scripts:0,png:[],source:[]};
for(const name of await readdir(out)){
 if(name.endsWith('.json')){await json(join(out,name));result.jsonFiles++;}
 if(name.endsWith('.mjs')){assert.equal(spawnSync(process.execPath,['--check',join(out,name)],{encoding:'utf8'}).status,0,name);result.scripts++;}
 if(name.endsWith('.png')){const image=sharp(join(out,name));const {width,height}=await image.metadata();await image.raw().toBuffer();result.png.push({name,width,height,sha256:hash(await readFile(join(out,name)))});}
}
const after=await json(join(out,'after-runtime.json')),before=await json(join(out,'before-runtime.json')),comparison=await json(join(out,'comparison-source.json'));
assert(comparison.restored);assert.equal(after.captures.length,4);assert.equal(before.captures.length,4);
for(const capture of after.captures){assert.equal(capture.h1.length,1);assert.equal(capture.overflow,false);assert.equal(capture.font,capture.font=== '18px'?'18px':'16px');assert.equal(capture.loadedFonts,'loaded');}
for(const entry of after.source){assert.equal(hash(await readFile(entry.path)),entry.rawSha256);}
for(const entry of comparison.files.filter(file=>!file.path.endsWith('route-metadata.ts'))){assert.equal(before.source.find(file=>file.path===entry.path).canonicalLfSha256,entry.historicalCanonicalLfSha256);}
const native=await json(join(out,'native-source.json'));assert(native.targetDocumentRequestsWorkspacePresent);assert.equal(hash((await readFile(native.source[0].path,'utf8')).replaceAll('\r\n','\n')),native.source[0].canonicalSha256);
const paths=execFileSync('git',['diff','--name-only','9847f784dfcdca922fd41936493ea07d4b896675','5cfe1d011f846fcb17152355daefdb6a387c9bd9'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(path=>/\.(ts|tsx)$/.test(path));
result.reconciliation={verifiedBase:'9f839b78f109b1f3eea1c40b959e76ae99efba3b',verifiedTree:execFileSync('git',['rev-parse','9f839b78f109b1f3eea1c40b959e76ae99efba3b^{tree}'],{encoding:'utf8'}).trim(),ownedDiffAfterMerge:execFileSync('git',['diff','--name-only','5cfe1d011f846fcb17152355daefdb6a387c9bd9','HEAD','--',...paths],{encoding:'utf8'}).trim(),ancestors:[]};
assert.equal(result.reconciliation.verifiedTree,'b3c2aa2f972dfac76153051fe957f24558a4f9b0');assert.equal(result.reconciliation.ownedDiffAfterMerge,'');
for(const sha of ['8a13b755220124c4ea1d3fd1ccacb770aae31241','26d1d8fd016d6daa0c9fe71e0f671571dd45c211',result.reconciliation.verifiedBase]){assert.equal(spawnSync('git',['merge-base','--is-ancestor',sha,'HEAD']).status,0);result.reconciliation.ancestors.push(sha);}
for(const path of paths){const bytes=await readFile(path),canonical=bytes.toString().replaceAll('\r\n','\n');result.source.push({path,rawSha256:hash(bytes),canonicalLfSha256:hash(canonical),canonicalGitBlob:execFileSync('git',['hash-object','--stdin'],{input:canonical,encoding:'utf8'}).trim(),crlf:bytes.includes(Buffer.from('\r\n'))});}
for(const[name,file]of [['unit','unit-post-merge.json'],['postgres','postgres.json']]){const raw=await json(join(out,file));assert.equal(raw.numFailedTests,0);result[name]={files:raw.testResults.length,tests:raw.numPassedTests};}
for(const[name,file]of [['actions','actions-runtime.json'],['recovery','recovery-runtime.json'],['variants','variants-runtime.json']]){const raw=await json(join(out,file));assert(!raw.failure);result[name]={checks:raw.checks.length};}
result.qualification='Fresh post-merge artifact decoding/parsing and final owned-source hashes. Earlier raw attempts and corrected archive metadata remain distinct. Before replaces only exact historical route consumers. Captures/native are pinned to pre-merge5cfe; all nine owned source hashes still match after verified9f839 merge. PG ran before the UI-only extraction/verified onboarding-only merge. Final source is committed with report docs still untracked at this verification.';
await writeFile(join(out,'artifact-verification.json'),JSON.stringify(result,null,2)+'\n');console.log('Verified artifacts and final source: '+result.unit.files+'/'+result.unit.tests+' units, '+result.postgres.files+'/'+result.postgres.tests+' PG, '+result.png.length+' PNGs.');
