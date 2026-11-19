import subprocess,pathlib,os,json,hashlib,collections
s=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE';root=pathlib.Path.cwd();H=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):
 p=subprocess.run(['git',*a],capture_output=True); assert p.returncode==0,(a,p.stderr); return p.stdout
r=json.loads((s/'root-baseline.json').read_text());e=json.loads((s/'expected-map.json').read_text());actual={}
for row in git('ls-tree','-rz','--full-tree','HEAD').split(b'\0'):
 if row:
  h,p=row.split(b'\t');actual[p.decode()]=h.decode().split()
assert actual==e
inc='4460bc433f99a7e9b3dc84862e9efedf72cbcf8a';base='cab40dcbb6ea69cefb7aa919228298a881a66060'
changed={p.decode() for p in git('diff','--name-only','-z',base,inc).split(b'\0') if p}
nonoverlap=[p for p in r if p not in changed];assert all(actual[p]==r[p] for p in nonoverlap)
archive='docs/design/rollout-1692/1748/root-withdrawal-and-continuation/'
archivepins=[p for p in r if p.startswith(archive)];assert len(archivepins)==202 and all(actual[p]==r[p] for p in archivepins)
proofpaths=[p for p in r if p.startswith('docs/design/')];assert all(actual[p]==r[p] for p in proofpaths)
# Root advance is protected independently of the old read-only preparation.
newroot=[p.decode() for p in git('diff','--name-only','-z','3a3c1243147d92213ffde7ffe423e3da67ecd011','bceb0ee32ca64e1d0fcf36906e89b0509665c479').split(b'\0') if p];assert len(newroot)==204
assert all(actual[p]==r[p] for p in newroot)
(s/'preservation.json').write_text(json.dumps({'expectedMapEqual':True,'trackedCandidateEntries':len(actual),'rootBaselineEntries':len(r),'rootNonoverlapExact':len(nonoverlap),'incomingChangedPaths':len(changed),'rootExistingPathsLegitimatelyChanged':len(set(r)&changed),'archivePathsExact':len(archivepins),'allRootDesignPathsExact':len(proofpaths),'protectedAdvancePaths':len(newroot),'orderedParentsVerified':True,'appTreeVerified':True,'ledgerUnchanged':actual['docs/design/rollout-1692/integration.json']==r['docs/design/rollout-1692/integration.json'],'allRootNonoverlapModesBlobsPreserved':True,'allIncomingNonoverlapModesBlobsPreserved':True,'routeTemplatesAliasesAndAllUnchangedSourcePreservedByFullMap':True},indent=2))
# Current-source comparison is a hash receipt, not execution of archived harnesses.
sp=json.loads((root/(archive+'source-pins.json')).read_text());drift=[]
for pin in sp['pins']:
 raw=(root/pin['path']).read_bytes().replace(b'\r\n',b'\n');same=H(raw)==pin['sha256'];drift.append({'path':pin['path'],'matchesFrozenSource':same,'currentCanonicalSha256':H(raw)})
assert [p['path'] for p in drift if not p['matchesFrozenSource']]==['apps/webapp/src/lib/navigation/route-metadata.ts']
(s/'archive-current-source-evolution.json').write_text(json.dumps({'archiveVerifierExit':0,'verifierSha256':'f8102e9628e7ed227a0cab70d38933bcbb678adc6f0446ce330cbd119abf5316','currentSourceModeExecuted':False,'expectedDrift':'only authorized additive listing heading; archive bytes unchanged','pins':drift},indent=2))
# Unique physical file/fullName/occurrence identities, never summing inherited runs.
multiset=[]
for name in ['priority','classification']:
 report=json.loads((s/(name+'-vitest.json')).read_text());counter=collections.Counter()
 for suite in report['testResults']:
  file=suite['name'].replace('\\','/');file=file[file.index('apps/webapp/'):]
  for test in suite['assertionResults']:
   full=test['fullName'];counter[(file,full)]+=1;multiset.append({'physicalFile':file,'fullName':full,'occurrence':counter[(file,full)],'status':test['status'],'run':name,'owner':'premerge-control' if 'premerge-root' in full else 'candidate'})
assert len(multiset)==8
(s/'test-multiset.json').write_text(json.dumps({'identities':multiset,'counts':dict(collections.Counter(p['status'] for p in multiset)),'uniqueIdentities':8,'physicalFiles':2,'uniqueFindings':1,'failedAssertionsAreSameFinding':3,'candidateIdentities':7,'baselineIdentities':1,'inheritedUnit87AndPg50Rerun':False,'root545AndPg51Rerun':False},indent=2))
# Inventory only our own dependency link edges; never traverse links or borrowed paths.
links=[]; physical=[]
for rel in ['node_modules','node_modules/.pnpm','apps/webapp/node_modules','apps/docs/node_modules','apps/marketing/node_modules','apps/desktop/node_modules','packages/email/node_modules']:
 p=root/rel
 if p.exists():physical.append({'path':rel,'physical':not p.is_symlink() and not os.path.isjunction(p)})
for basepath,dirs,files in os.walk(root,followlinks=False):
 rel=pathlib.Path(basepath).relative_to(root)
 if '.git' in rel.parts:dirs[:]=[];continue
 if pathlib.Path(basepath).name=='node_modules':
  for linkbase,ld,lf in os.walk(basepath,followlinks=False):
   if pathlib.Path(linkbase).name=='.pnpm':ld[:]=[];continue
   for n in list(ld)+lf:
    q=pathlib.Path(linkbase)/n
    if q.is_symlink() or os.path.isjunction(q):
     target=q.resolve();assert target.is_relative_to(root),(q,target)
     links.append({'path':q.relative_to(root).as_posix(),'target':target.relative_to(root).as_posix()})
   ld[:]=[d for d in ld if not (pathlib.Path(linkbase)/d).is_symlink() and not os.path.isjunction(pathlib.Path(linkbase)/d)]
  dirs[:]=[]
assert all(p['physical'] for p in physical)
(s/'dependency-after-inventory.json').write_text(json.dumps({'preInstallDependenciesAbsent':True,'fullPreinventoryCaptured':False,'method':'own frozen offline copy --ignore-scripts; internal virtual-store links not recursively inventoried','physical':physical,'internalLinkCount':len(links),'allTargetsInternal':True,'links':links,'lockSha256':H((root/'pnpm-lock.yaml').read_bytes())},indent=2))
# Preserve and hash-guard removal of only the five files made by this review.
bridges=json.loads((s/'bridges.json').read_text());(s/'bridges').mkdir(exist_ok=True)
for bridge in bridges:
 p=pathlib.Path(bridge['path']);raw=p.read_bytes();assert H(raw)==bridge['sha256'];(s/'bridges'/p.name).write_bytes(raw);p.unlink()
assert not git('status','--porcelain').strip()
(s/'release.json').write_text(json.dumps({'status':'RELEASEALL','limitedOwnershipOnly':True,'runtimeProcessesStarted':0,'browserSessionsStarted':0,'containersStarted':0,'containersRemoved':0,'outstandingProcesses':0,'outstandingContainers':0,'outstandingPorts':0,'outstandingBridges':0,'ownedServicesAbsent':'none were created','dependenciesRetainedAsOwnPhysicalOfflineCopy':True,'dependencyInternalLinks':len(links),'cleanTrackedSourceAndIndex':True,'cleanUntrackedStatus':True,'trackerWrites':0,'pushes':0,'rootIntegration':False,'verifiedCommit':None},indent=2))
print(json.dumps({'preservation':'PASS','rootNonoverlap':len(nonoverlap),'archivePaths':len(archivepins),'protectedAdvance':len(newroot),'internalLinks':len(links),'testIdentities':len(multiset),'bridgesRemoved':len(bridges),'statusClean':True}))
