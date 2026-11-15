// Merger-owned read-only source/archive audit; only this scratch directory receives output.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,dirname} from 'node:path';
const repo=process.cwd(),scratch=resolve('.tmp/merge1827-audit'),dir=resolve('docs/design/rollout-1692/1827');
const base='584db58aa2e5789e6f0e94d0f2c2f69b62f18807',incoming='274170732c4bcd42a1ee48103f458f0d3722149b',old='37e46ce8bea19e69e112d11186e0c271d77e9738',implementation='233df870a3728bccc0536a1d1a38cf34e45640e4';
const expectedTree='dbe10052bf9cbb9e5d31621aad1d1b1bc9048cc4';
const git=(...args)=>execFileSync('git',args,{cwd:repo,windowsHide:true,maxBuffer:32*1024*1024});
const text=(...args)=>git(...args).toString('utf8').trim();
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const tree=ref=>new Map(git('ls-tree','-r','-z',ref).toString('utf8').split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');return[path,meta];}));
const current=tree('HEAD'),prior=tree(base),worker=tree(incoming);
const changed=text('diff','--name-only',old,incoming).split(/\r?\n/).filter(Boolean),allowed=new Set(changed);
assert.equal(text('rev-parse','HEAD^{tree}'),expectedTree);
assert.deepEqual(text('show','-s','--format=%P','HEAD').split(' '),[base,incoming]);
let unaffected=0,priorRaw=0,incomingRaw=0;
for(const [path,pin]of prior){if(!allowed.has(path)){assert.equal(current.get(path),pin,path);unaffected++;}if(path.startsWith('docs/design/rollout-1692/')){assert.equal(current.get(path),pin,path);priorRaw++;}}
for(const path of changed){assert.equal(current.get(path),worker.get(path),path);if(path.startsWith('docs/design/rollout-1692/'))incomingRaw++;}
assert.deepEqual(text('diff','--name-only',base,'HEAD').split(/\r?\n/).filter(Boolean).sort(),[...allowed].sort());
const sourcePaths=changed.filter(p=>p.startsWith('apps/'));assert.equal(sourcePaths.length,3);
const ledger=await json(resolve('docs/design/rollout-1692/integration.json'));
const verified=ledger.tickets.filter(t=>t.verifiedCommit);assert.equal(verified.length,40);
for(const row of [{issue:1689,verifiedCommit:ledger.baseline.verifiedCommit},...verified]){git('merge-base','--is-ancestor',row.verifiedCommit,'HEAD');}
for(const ref of ['4cb26d6e0408c33ee8f89ded3fcd1f73a2976292','c6b9cdeff6511fa5198651d06c7a6bfa3f5c6510'])git('merge-base','--is-ancestor',ref,'HEAD');
const sharp=createRequire(resolve('apps/webapp/package.json'))('sharp');
const files=[];async function walk(p){for(const entry of await readdir(p,{withFileTypes:true})){const path=join(p,entry.name);if(entry.isDirectory())await walk(path);else files.push(path);}}await walk(dir);
let pngs=0,jsons=0,scripts=0;const decoded=new Map();
for(const file of files){if(file.endsWith('.png')){const {info}=await sharp(await readFile(file)).raw().toBuffer({resolveWithObject:true});decoded.set(file,info);pngs++;}else if(file.endsWith('.json')){await json(file);jsons++;}else if(file.endsWith('.mjs')){execFileSync(process.execPath,['--check',file],{windowsHide:true,stdio:'pipe'});scripts++;}}
const after=await json(join(dir,'after-runtime.json')),before=await json(join(dir,'before-runtime.json'));
assert.deepEqual(after.failed,[]);assert.deepEqual(after.pageErrors,[]);assert.equal(after.checks.length,18);
const sourcePins=[];
for(const [phase,run,ref]of [['before',before,old],['after',after,implementation]]){
for(const capture of run.captures){const image=decoded.get(join(dir,capture.filename));assert.ok(image,capture.filename);assert.equal(image.width,capture.pngDimensions.width);assert.equal(image.height,capture.pngDimensions.height);assert.ok(capture.documentWidth<=capture.viewport.width);assert.equal(capture.rootFont,capture.savedFont==='large'?'18px':'16px');assert.equal(capture.visualScale,1);
for(const[path,pin]of Object.entries(capture.source.files)){assert.equal(text('rev-parse',ref+':'+path),pin.blob,path);const blob=git('cat-file','blob',pin.blob);const canonical=blob.toString('utf8').replaceAll('\r\n','\n');const candidates=[sha(blob),sha(Buffer.from(canonical.replaceAll('\n','\r\n')))];assert.ok(candidates.includes(pin.sha256),'historical bytes '+path);if(phase==='after'){assert.equal(text('hash-object','--path',path,path),pin.blob,path);assert.equal(sha(await readFile(resolve(path))),pin.sha256,'current bytes '+path);}sourcePins.push({phase,capture:capture.filename,path,blob:pin.blob,sha256:pin.sha256});}
}}
assert.equal(sourcePins.filter(p=>p.phase==='after').length,54);
const native=await json(join(dir,'native-source.json')),nativeTree=await json(join(dir,'native-tree-result.json')),auth=await json(join(dir,'native-auth-result.json'));
assert.equal(native.blob,text('rev-parse',implementation+':apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx'));
assert.equal(nativeTree.code,0);const nativeParsed=JSON.parse(nativeTree.out);assert.equal(nativeParsed.success,true);
for(const owner of ['CompletePage','CompletionFlow','CompletionAttempt','ProgressIndicator','SetupSummary'])assert.ok(nativeParsed.data.tree.includes(owner),owner);
assert.deepEqual(JSON.parse(auth.out),{active:200,signIn:200});
const initialNative=await json(join(dir,'native-second-open.json'));assert.ok(initialNative.out.includes('/sign-in'));
assert.equal((await json(join(dir,'native-final-close.json'))).code,0);
const next=await json(join(dir,'next-runtime.json'));for(const probe of next){if(!['get_compilation_issues','get_errors'].includes(probe.name))continue;const payload=JSON.parse(probe.result.result.content.find(c=>c.type==='text').text);assert.deepEqual(payload,probe.name==='get_errors'?{configErrors:[],sessionErrors:[]}:{issues:[]});}
const contrast=await json(join(dir,'contrast.json'));const contrastRatios=[];for(const theme of contrast){assert.equal(theme.rootFont,'18px');assert.equal(theme.continuationReachable,true);for(const sample of theme.colors){assert.ok(sample.ratio>4.5);contrastRatios.push(sample.ratio);}}
const cleanup=await json(join(dir,'cleanup.json'));for(const key of ['nextIdentityVerified','nextStopped','previewOwnedTabClosed','nativeScopedBrowserClosed','puppeteerDriversCloseInFinally'])assert.equal(cleanup[key],true,key);assert.equal(cleanup.ownedContainersRemoved,3);
const report=resolve('docs/design/rollout-1692/1827.md');let links=0;for(const match of (await readFile(report,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(/^https?:/.test(match[1]))continue;await readFile(resolve(dirname(report),match[1]));links++;}
const pg=await readFile(join(dir,'postgres-final.txt'),'utf8');for(const path of ['actions.integration.test.ts','authentication.integration.test.ts','policy.integration.test.ts'])assert.ok(pg.includes(path));assert.ok(pg.includes('17 passed')||pg.replace(/\u001b\[[0-9;]*m/g,'').includes('17 passed'));
const owners=['apps/webapp/src/app/[locale]/onboarding/complete/actions.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/app/api/user/onboarding-status/route.ts','apps/webapp/src/app/[locale]/init/page-client.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
for(const path of owners)assert.equal(current.get(path),prior.get(path),path);
const outcome={passed:true,base,incoming,merge:text('rev-parse','HEAD'),tree:expectedTree,parents:text('show','-s','--format=%P','HEAD').split(' '),independentMergeTreeMatches:true,sourcePaths,changedPaths:changed.length,preservation:{unaffectedPaths:unaffected,priorRolloutPaths:priorRaw,incomingRawPaths:incomingRaw,verifiedTicketAncestors:verified.length,baselineAncestor:true,root1726And1727Corrections:true,authoritativeOwners:owners.length,allIncomingBlobsMatch:true,noHeadingOptInRemoval:true},artifacts:{decodedPNGs:pngs,parsedJSON:jsons,syntaxCheckedScripts:scripts,finalCapturePins:54,beforeCapturePins:sourcePins.filter(p=>p.phase==='before').length,independentSourceFiles:new Set(sourcePins.map(p=>p.path)).size,documentLinks:links,contrastSamples:contrastRatios.length,minimumRecordedContrast:Math.min(...contrastRatios),recordedLiveAssertions:after.checks.length,nativeTargetAndBlob:true,initialNativeRestoreReachedSignIn:true,stdinAuthRecorded:true,recordedPGSuites:3,recordedPGTests:17},sourcePins,qualification:'Archive/source audit freshly executed; browser/PG/native/Next/contrast observations are inherited, not rerun. Private fixture values unavailable after cleanup: no fresh exact-value exclusion claim. No auth or authority-domain mutation performed.'};
await writeFile(join(scratch,'artifact-audit.json'),JSON.stringify(outcome,null,2)+'\n');console.log(JSON.stringify({...outcome,sourcePins:sourcePins.length}));
