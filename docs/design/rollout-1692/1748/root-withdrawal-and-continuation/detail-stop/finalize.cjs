const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const dir='.tmp/review1748';
const git=(...args)=>cp.execFileSync('git',args,{maxBuffer:40*1024*1024});
const str=(...args)=>git(...args).toString().trim();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const prediction=JSON.parse(fs.readFileSync(dir+'/prediction.json'));
const trees=ref=>new Map(git('ls-tree','-rz','--full-tree',ref).toString().split('\0').filter(Boolean).map(line=>{
 const m=/^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);return[m[4],{mode:m[1],type:m[2],oid:m[3]}];
}));
const root=trees(prediction.root),candidate=trees('HEAD'),incoming=trees(prediction.incoming);
const changed=new Map(prediction.changes.map(c=>[c.path,c]));
const mismatch=[];let rootPreserved=0,incomingPreserved=0;
for(const [p,e] of root)if(!changed.has(p)){if(JSON.stringify(e)!==JSON.stringify(candidate.get(p)))mismatch.push(p);else rootPreserved++;}
for(const [p,c] of changed){if(JSON.stringify(candidate.get(p)||null)!==JSON.stringify(c.expected))mismatch.push(p);if(!prediction.overlaps.includes(p)&&JSON.stringify(candidate.get(p))===JSON.stringify(incoming.get(p)))incomingPreserved++;}
const extra=[...candidate.keys()].filter(p=>!root.has(p)&&!changed.has(p));
if(mismatch.length||extra.length||str('rev-parse','HEAD^{tree}')!==prediction.predictedTree)throw Error('Preservation mismatch');
const bridges=JSON.parse(fs.readFileSync(dir+'/bridges.json'));
const cleanup=[];
for(const b of bridges){const digest=hash(fs.readFileSync(b.path));if(digest!==b.sha256)throw Error('Bridge changed: '+b.path);fs.unlinkSync(b.path);cleanup.push({...b,removed:true});}
fs.writeFileSync(dir+'/bridge-cleanup.json',JSON.stringify(cleanup,null,2)+'\n');
const runs=[['priority-existing',0],['refusal-review',1],['refusal-confirmed',1]];
const results=runs.map(([name,exit])=>{
 const j=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));const seen=new Map();
 const tests=j.testResults.flatMap(f=>f.assertionResults.map(t=>{
  const file=f.name.replaceAll('\\','/').split('/apps/webapp/')[1];const key=file+'\0'+t.fullName;
  const occurrence=(seen.get(key)||0)+1;seen.set(key,occurrence);
  return {file,fullName:t.fullName,occurrence,status:t.status};
 }));
 return{name,exit,passed:j.numPassedTests,failed:j.numFailedTests,tests};
});
const distinct=new Map();for(const r of results)for(const t of r.tests)distinct.set(t.file+'\0'+t.fullName+'\0'+t.occurrence,t);
const report={
 candidate:str('rev-parse','HEAD'),tree:str('rev-parse','HEAD^{tree}'),app:str('rev-parse','HEAD:apps/webapp'),orderedParents:str('show','-s','--format=%P','HEAD').split(' '),
 predictedTreeMatches:true,predictedAppMatches:str('rev-parse','HEAD:apps/webapp')===prediction.predictedApp,
 rootPaths:root.size,candidatePaths:candidate.size,rootNonoverlapPreserved:rootPreserved,incomingNonoverlapPreserved:incomingPreserved,composedPaths:prediction.overlaps,
 nonoverlapBlobModeMismatches:mismatch,unpredictedPaths:extra,
 trackedWorktreeStatus:str('status','--porcelain=v1'),runs:results,
 resultMultiset:{distinctCases:distinct.size,passesAtLatestOccurrence:[...distinct.values()].filter(t=>t.status==='passed').length,failuresAtLatestOccurrence:[...distinct.values()].filter(t=>t.status==='failed').length,rerunOverlap:3,existingSelectionOverlapWithWorker:28,workerCountsAdded:0},
 verifiedCommit:null,issue:'OPEN',acceptanceStopped:true,
 finding:{severity:'P1',path:'apps/webapp/src/components/travel-expenses/travel-expense-claim-detail.tsx',lines:[238,240],sequence:[200,404,503],after404:{notesVisible:false,downloadVisible:false},after503:{notesVisible:true,downloadVisible:true},baseline:'The pinned root retains notes and receipt links through 404 and 503; candidate adds withdrawal at 404 but loses it on 503.',classification:'Synthetic public component/provider/QueryClient HTTP-boundary failure; incomplete new refusal guarantee atop inherited retained cache; no live authorization or receipt byte access proved.'},
 skippedAfterStop:['Remaining priority challenges','Deduplicated 124-case compatibility selection','Today/R096 gates','PostgreSQL','Next typegen and all three TS projects','Lint and formatting','Doctor','Curated artifact audit'],
 inheritedOnly:['124 worker unit cases','51 distinct worker PostgreSQL cases with timeout qualification','Three TypeScript projects','Doctor 100','Browser/native/receipt/settlement captures; no final shared correction live capture'],
 package:{version:'12.16.1',install:'frozen/offline/ignore-scripts/package-import-method=copy',physicalOwnRoots:['node_modules','apps/webapp/node_modules','node_modules/.pnpm'],installExit:0,versionProbeQualification:'Restricted initial --version probe warned of engine-store access and printed fallback 12.21.0. No package/test/install command used that fallback. Escalated --version confirmed 12.16.1 before install and tests.'},
 ownership:{bridgesRemoved:cleanup.length,activeCommands:0,ownedRuntimeProcesses:0,ownedListeners:0,ownedContainers:0,createdRuntimeProcesses:0,createdListeners:0,createdContainers:0,packageWorkSettled:true,checkoutIndexGitReleased:true,rootCheckoutTouched:false,sourceFixes:false,trackerWrites:false,push:false,pr:false,watch:false,readinessAdvance:false},
 artifactAudit:'NOT RUN: stopped on first confirmed priority blocker; the committed public spec and manifest header were read, and every incoming artifact blob/mode is preserved by the tree comparison. No new PNG/pixel/timing/secret-scan acceptance.'
};
if(report.trackedWorktreeStatus)throw Error('Candidate is not clean');
for(const p of report.package.physicalOwnRoots){if(fs.lstatSync(p).isSymbolicLink())throw Error('Borrowed dependency root');const resolved=fs.realpathSync(p);if(!resolved.toLowerCase().startsWith(process.cwd().toLowerCase()))throw Error('External dependency root');}
fs.writeFileSync(dir+'/review-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,runs:report.runs.map(({tests,...rest})=>rest)},null,2));
