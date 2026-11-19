from review import *
import re, ast
labels=['priority-original','priority-detail','priority-objections','priority-objections-settled','priority-objections-waited','priority-objections-controlled','actual-consumers','compatibility','integration','real-refresh']
latest={}; history=[]
for label in labels:
 r=json.loads((OUT/(label+'.json')).read_text()); rows=[]
 for f in r['testResults']:
  counts=collections.Counter()
  for a in f['assertionResults']:
   file=pathlib.Path(f['name']).relative_to(ROOT).as_posix(); name=a['fullName']; counts[name]+=1
   key=(file,name,counts[name]); entry=dict(file=file,fullName=name,occurrence=counts[name],status=a['status'],run=label)
   rows.append(entry)
   if a['status']!='pending': latest[key]=entry
 history.append(dict(run=label,reportedTotal=r['numTotalTests'],reportedPass=r['numPassedTests'],reportedFail=r['numFailedTests'],reportedPending=r.get('numPendingTests'),cases=rows))
units=[v for v in latest.values() if not v['file'].endswith('.integration.test.ts')]
pg=[v for v in latest.values() if v['file'].endswith('.integration.test.ts')]
save('test-multiset.json',dict(identity='physical file / full name / occurrence; later reruns replace earlier statuses; pending bail states do not create acceptance',latest=list(latest.values()),history=history,unitDistinct=len(units),unitFiles=len(set(v['file'] for v in units)),unitStatuses=dict(collections.Counter(v['status'] for v in units)),pgDistinct=len(pg),pgFiles=len(set(v['file'] for v in pg)),pgStatuses=dict(collections.Counter(v['status'] for v in pg)),rootOverlap=518,ownControlAndObjectionCases=len(units)-518,baselineControls=3,semanticOverlap='Four original conversion candidate predicates also occur in the permanent suite. Original detail predicates and history consumer predicates overlap permanent coverage. These are independent reproductions, not new feature coverage.'))
before=json.loads((SAFE/'pins-before.json').read_text()); after=json.loads((SAFE/'pins-after.json').read_text())
assert before['files']==after['files'] and before['head']==after['head'] and before['appTree']==after['appTree'] and before['indexSha256']==after['indexSha256'] and after['status']==''
receipt=json.loads((ROOT/'docs/design/rollout-1692/1748/root-conversion-withdrawal-correction.json').read_text()); current=[]
for x in receipt['sourcePins']+receipt['frozenOwnerPins']:
 actual=git('rev-parse','HEAD:'+x['path']); assert actual==x['blob']; current.append(dict(path=x['path'],blob=actual,match=True))
prefixes=[]
for n,sha in [(19422,'6c6b9e7ec408c6a683923c5a18a6c277fb47ecdf9b1acd0d89350c1d4bafa00b'),(22126,'acba4965d16261f8472d92327eefd627a4cd82d40b290561c4b42a476a5a022c')]:
 b=(ROOT/'docs/design/rollout-1692/1748.md').read_bytes(); match=digest(b[:n])==sha; assert match
 prefixes.append(dict(bytes=n,expectedSha256=sha,rawMaterializedPrefixMatch=match))
links=[]
for dep in ['node_modules','apps/webapp/node_modules']:
 parent=ROOT/dep
 for p in list(parent.iterdir()):
  group=list(p.iterdir()) if p.name.startswith('@') and p.is_dir() and not p.is_symlink() else [p]
  for q in group:
   if q.is_symlink() or q.is_junction():
    resolved=q.resolve(); links.append(dict(path=q.relative_to(ROOT).as_posix(),target=str(resolved),internal=resolved.is_relative_to(ROOT)))
assert all(x['internal'] for x in links)
save('preservation.json',dict(unchangedTrackedFiles=len(before['files']),sourceAndConfigBytesEqual=True,indexSha256=after['indexSha256'],indexUnchanged=True,head=after['head'],appTree=after['appTree'],gitStatus=after['status'],sourcePins=current,reportPrefixes=prefixes,lockSha256=next(x['sha256'] for x in after['files'] if x['path']=='pnpm-lock.yaml'),dependencyTopology=links,dependencies='Owned physical offline install only; no linked peer/root dependencies. Before snapshot records installed physical roots during installation; package-link audit is after-only, not a reconstructed pre-test topology.',canonicalOwners='Four frozen owner blobs match producer receipt. No source, canonical writer, permissions, schema or metadata edits.'))
print(json.dumps(dict(unit=len(units),unitFiles=len(set(v['file'] for v in units)),pg=len(pg),own=len(units)-518,links=len(links))))
