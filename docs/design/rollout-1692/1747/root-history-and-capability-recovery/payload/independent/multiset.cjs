const fs=require('node:fs');
const safe='.tmp/r165-independent-SAFE';
const read=p=>JSON.parse(fs.readFileSync(p));
const key=x=>JSON.stringify([x.file,x.fullName,x.occurrence]);
function extract(p){
 const r=read(p),out=[],counts=new Map();
 for(const f of r.testResults)for(const a of f.assertionResults){
  const file=f.name.replaceAll('\\','/').split('/apps/webapp/').pop();
  const id=JSON.stringify([file,a.fullName]),occurrence=(counts.get(id)||0)+1;counts.set(id,occurrence);
  out.push({file,fullName:a.fullName,occurrence,status:a.status});
 }
 return {result:p,total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests,cases:out};
}
const runs=['priority-attempt1','priority-attempt2','priority-final','unit13','pg6'].map(id=>({id,...extract(`${safe}/${id}.json`)}));
const final=runs.filter(x=>['priority-final','unit13','pg6'].includes(x.id));
const latest=final.flatMap(x=>x.cases.map(c=>({...c,run:x.id})));
if(new Set(latest.map(key)).size!==253||latest.some(x=>x.status!=='passed'))throw Error('Final multiset mismatch');
const inherited=read('docs/design/rollout-1692/1748/root-withdrawal-and-continuation/independent/test-multiset.json').latest;
const norm=p=>p.replaceAll('\\','/').split('/apps/webapp/').pop().replace(/^apps\/webapp\//,'');
const oldKeys=new Set(inherited.map(x=>key({...x,file:norm(x.file)})));
const archiveOverlaps=latest.filter(x=>oldKeys.has(key(x)));
const repeats=runs.slice(0,2).map(r=>({run:r.id,notAdditive:true,identities:r.cases.filter(c=>latest.some(x=>key(c)===key(x))).map(c=>({file:c.file,fullName:c.fullName,occurrence:c.occurrence,status:c.status}))}));
const result={schemaVersion:1,verifiedCommit:null,identity:['file','fullName','occurrence'],latest,finalRuns:final.map(({cases,...r})=>r),
 counts:{unit:203,unitFiles:14,pg:50,pgFiles:6,distinct:253,files:20},nonadditiveRepeats:repeats,
 overlapsWithFrozen1748:{inheritedOnly:true,notAdded:true,total:archiveOverlaps.length,unit:archiveOverlaps.filter(x=>x.run!=='pg6').length,pg:archiveOverlaps.filter(x=>x.run==='pg6').length,identities:archiveOverlaps},
 historicalQualification:'Root 183, standalone 9, reconciled 30, historical exact 7/current and failed premerge control, former worker 87/50, and #1748 545/51 are not added to the 253 current distinct identities.'};
fs.writeFileSync(safe+'/case-multiset.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result.counts,overlap1748:result.overlapsWithFrozen1748.total,overlapUnit:result.overlapsWithFrozen1748.unit,overlapPG:result.overlapsWithFrozen1748.pg}));
