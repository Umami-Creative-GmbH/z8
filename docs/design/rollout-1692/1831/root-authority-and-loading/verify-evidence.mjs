// Read-only verification. Never regenerates or rewrites tracked evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const dir=new URL('.',import.meta.url),root=new URL('../../../../../',import.meta.url);
const json=async n=>JSON.parse((await readFile(new URL(n,dir),'utf8')).replace(/^\ufeff/,''));
const sha=b=>createHash('sha256').update(b).digest('hex'),canon=b=>b.toString('utf8').replaceAll('\r\n','\n');
const sharp=createRequire(new URL('apps/webapp/package.json',root))('sharp'),q=await json('quality.json');
for(const[p,pin]of Object.entries(q.sourcePins)){const b=execFileSync('git',['show',q.sourceCommit+':'+p],{cwd:fileURLToPath(root)});assert.equal(sha(b),pin);if(process.argv.includes('--current-source'))assert.equal(canon(await readFile(new URL(p,root))),canon(b));}
const files=new Set(),union=new Set();
for(const n of ['compatibility','scope-independent','scope-focused']){const r=await json(n+'.json');assert.equal(r.numFailedTests,0);assert.equal(r.numPendingTests,0);for(const f of r.testResults){const p=f.name.toLowerCase().replaceAll('\\','/'),seen=new Map();files.add(p);for(const t of f.assertionResults){assert.equal(t.status,'passed');const ordinal=seen.get(t.fullName)??0;seen.set(t.fullName,ordinal+1);union.add(p+'\0'+t.fullName+'\0'+ordinal);}}}
assert.equal(files.size,178);assert.equal(union.size,1822);
for(const[n,failed]of[['authority-red',1],['loading-red',2],['postgres-baseline',1],['postgres-scope-red',1]])assert.equal((await json(n+'.json')).numFailedTests,failed);
const pg=await json('postgres.json');assert.equal(pg.numPassedTests,99);assert.equal(pg.numFailedTests,0);assert.equal(pg.numPendingTests,0);assert.equal(pg.testResults.length,3);
assert.equal((await json('compatibility-command.json')).exitCode,1); // Historical first failure, deliberately retained.
const doctor=await json('scope-doctor.json');assert.equal(doctor.summary.errorCount,0);assert.equal(doctor.summary.warningCount,0);assert.equal(doctor.sourceRevision,q.doctor.scannedRevision);assert.equal(q.doctor.existingExceptions,2);
let captures=0;
for(const phase of ['before','after']){const r=await json('runtime/'+phase+'.json');assert.equal(r.head,q.sourceCommit);assert.equal(r.checks.length,phase==='before'?5:9);assert.deepEqual(r.errors,[]);if(phase==='after')assert.deepEqual(r.commands,{aborted:1,held:1,completed:[200]});
 for(const pin of r.source){const filename=pin.path.endsWith('page-client.tsx')?'client-source-'+phase+'.tsx.txt':'server-source-final.ts.txt';const b=await readFile(new URL(filename,dir));assert.equal(sha(b),pin.sha256);assert.equal(sha(canon(b)),pin.canonicalSha256);const expected=execFileSync('git',['show',(phase==='before'&&pin.path.endsWith('page-client.tsx')?q.base:q.sourceCommit)+':'+pin.path],{cwd:fileURLToPath(root)});assert.equal(canon(b),canon(expected));}
 for(const c of r.captures){const b=await readFile(new URL('runtime/'+c.name,dir));assert.equal(sha(b),c.sha256);const{info}=await sharp(b).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,c.viewport.width);assert.equal(info.height,c.viewport.height);assert.ok(c.documentWidth<=c.viewport.width);assert.deepEqual(c.headings,phase==='before'?[]:['Set up vacation policy']);assert.equal(c.policyControls,0);assert.equal(c.font,'16px');captures++;}
}
assert.equal(captures,4);const continuation=await json('runtime/restricted-continuation.json');assert.equal(continuation.head,q.sourceCommit);assert.equal(continuation.checks.length,4);assert.deepEqual(continuation.errors,[]);assert.equal(continuation.restrictedActions.length,2);for(const a of continuation.restrictedActions){assert.equal(a.http,200);assert.equal(a.success,false);assert.equal(a.code,'AuthorizationError');}
for(const r of [await json('runtime/before.json'),continuation])for(const item of r.next){const value=JSON.parse(item.result.result.content.find(x=>x.type==='text').text);assert.deepEqual(value,item.name==='get_errors'?{configErrors:[],sessionErrors:[]}:{issues:[]});}
assert.deepEqual(await json('native-auth-status.json'),{code:0,signIn:200,active:200});const native=await json('native-source.json');assert.equal(native.head,q.sourceCommit);for(const p of native.source)assert.equal(p.canonicalSha256,q.sourcePins[p.path]);const tree=await json('native-tree.json');assert.equal(tree.code,0);for(const n of ['PolicyAccessLoading','VacationPolicyHeader'])assert.ok(tree.out.includes(n));assert.equal((await json('native-close.json')).code,0);
const cleanup=await json('cleanup.json');for(const k of ['ownedNextIdentityVerified','ownedNextStopped','portClosed','puppeteerBrowsersClosed','nativeBrowserClosed'])assert.equal(cleanup[k],true);assert.equal(cleanup.ownedContainers,6);assert.equal(cleanup.remainingOwnedContainers,0);assert.equal(cleanup.credentialStateTransferred,false);assert.equal((await json('sensitive-exclusion.json')).passed,true);
let pngs=0,jsons=0,scripts=0;const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const p=new URL(e.name+(e.isDirectory()?'/':''),d);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.png')){await sharp(await readFile(p)).raw().toBuffer();pngs++;}else if(e.name.endsWith('.json')){JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));jsons++;}else if(e.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',fileURLToPath(p)],{stdio:'pipe'});scripts++;}}};await walk(dir);
console.log(JSON.stringify({passed:true,uniqueUnitFiles:files.size,uniqueUnitCases:union.size,postgresFiles:3,postgresPassed:99,acceptedCurrentCaptures:captures,decodedPNGs:pngs,parsedJSON:jsons,syntaxCheckedScripts:scripts,currentOwnedSource:process.argv.includes('--current-source')}));
