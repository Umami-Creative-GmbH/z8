import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const dir='.tmp/1733-command-checks/runtime';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fileHash=p=>hash(fs.readFileSync(p));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:40e6,stdio:['ignore','pipe','pipe']}).trim();
const expected='786ae5a9c81dd5b60d00d74f9a3534b45ed90242';
assert.equal(git('rev-parse','HEAD'),expected);
const tree=ref=>new Map(git('ls-tree','-r',ref).split('\n').map(l=>{const [m,p]=l.split('\t');return[p,m];}));
const prior=tree('c72c947e0faa21966fa24decc493ae96df3115f8'), current=tree('HEAD'), incoming=tree('258c18d2f7f87658f816f5276301297e9eaa60da');
const proofs=[...prior].filter(([p])=>p.startsWith('docs/design/rollout-1692/'));
const incomingProofs=[...incoming].filter(([p])=>p==='docs/design/rollout-1692/1733.md'||p.startsWith('docs/design/rollout-1692/1733/'));
const baseline=JSON.parse(fs.readFileSync('docs/design/rollout-1692/1732/root-loading-and-retry/source-pins.json','utf8'));
const config=baseline.configPins.map(x=>({path:x.path,rawSha256:fileHash(x.path),expectedRawSha256:x.runtimeRawSha256,match:fileHash(x.path)===x.runtimeRawSha256}));
assert.equal(config.length,36);assert.ok(config.every(x=>x.match));
const parents=['node_modules','apps/webapp/node_modules','node_modules/.pnpm'].map(p=>({path:p,directory:fs.lstatSync(p).isDirectory(),link:fs.lstatSync(p).isSymbolicLink()}));
const links=[];
function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const full=path.join(p,d.name);const s=fs.lstatSync(full);if(s.isSymbolicLink())links.push([full.replaceAll('\\','/'),fs.readlinkSync(full)]);else if(s.isDirectory()&&full.replaceAll('\\','/')!=='node_modules/.pnpm')walk(full);}}
walk('node_modules');walk('apps/webapp/node_modules');
const previousLinks=JSON.parse(fs.readFileSync('.tmp/merge1732-audit/final-state.json','utf8')).links.map(x=>[x.path,x.target]);
assert.deepEqual(links,previousLinks);assert.equal(links.length,158);
const ledger=JSON.parse(fs.readFileSync('docs/design/rollout-1692/integration.json','utf8'));
const ancestors=ledger.tickets.filter(x=>x.verifiedCommit).map(x=>({issue:x.issue,commit:x.verifiedCommit,ancestor:spawnSync('git',['merge-base','--is-ancestor',x.verifiedCommit,'HEAD']).status===0}));
assert.equal(ancestors.length,56);assert.ok(ancestors.every(x=>x.ancestor));
const sourcePaths=[
 'apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batch-workspace-scope.test.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batch-workspace.test.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batch-start.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batch-start.test.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batches-scope.tsx',
 'apps/webapp/src/components/site-header.tsx',
 'apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/[batchId]/page.tsx',
 'apps/webapp/src/components/personnel-file/payslip-batch-loading-heading.tsx',
 'apps/webapp/src/lib/personnel-file/payslip-batch.integration.test.ts',
 'apps/webapp/src/lib/navigation/route-metadata.ts',
];
const sourcePins=sourcePaths.map(p=>({path:p,rawSha256:fileHash(p),lfSha256:hash(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')),gitBlob:git('rev-parse','HEAD:'+p),matchesHeadLF:hash(execFileSync('git',['show','HEAD:'+p],{maxBuffer:10e6}))===hash(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'))}));
assert.ok(sourcePins.every(x=>x.matchesHeadLF));
const changedProofs=proofs.filter(([p,b])=>current.get(p)!==b).map(([p])=>p);
const changedIncoming=incomingProofs.filter(([p,b])=>current.get(p)!==b).map(([p])=>p);
assert.deepEqual(changedProofs.sort(),['docs/design/rollout-1692/README.md','docs/design/rollout-1692/integration.json']);assert.deepEqual(changedIncoming,[]);
const lock=fileHash('pnpm-lock.yaml');assert.equal(lock.toUpperCase(),'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
const status=git('status','--porcelain=v1','--untracked-files=all');assert.equal(status,'');
const result={head:expected,tree:git('rev-parse','HEAD^{tree}'),applicationTree:git('rev-parse','HEAD:apps/webapp'),sourcePins,configPins:config,dependencyParents:parents,dependencyLinks:links.length,dependencyLinksUnchanged:true,lockSha256:lock,verifiedAncestors:ancestors,baselineAncestor:spawnSync('git',['merge-base','--is-ancestor',ledger.baseline.verifiedCommit,'HEAD']).status===0,priorRolloutPaths:proofs.length,unchangedPriorRolloutPaths:proofs.length-changedProofs.length,changedPriorRolloutPathsAtGrant:changedProofs,grantChangeBoundary:'These two root publication status files already differ at pinned grant786ae5a9. No verifier write; every tracked file remains exactly HEAD.',incomingProofPaths:incomingProofs.length,changedIncomingProofPaths:changedIncoming,root1732ProofPaths:proofs.filter(([p])=>p.startsWith('docs/design/rollout-1692/1732/root-loading-and-retry/')).length,root1731ProofPaths:proofs.filter(([p])=>p.startsWith('docs/design/rollout-1692/1731/root-current-selection/')).length,root1730ProofPaths:proofs.filter(([p])=>p.startsWith('docs/design/rollout-1692/1730/root-request-confirmations/')).length,status};
fs.writeFileSync(dir+'/preservation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:expected,tree:result.tree,applicationTree:result.applicationTree,configs:config.length,dependencyParents:parents,links:links.length,verifiedAncestors:ancestors.length,priorProof:proofs.length,incomingProof:incomingProofs.length,clean:true,ownedBridgesRemoved:2}));
