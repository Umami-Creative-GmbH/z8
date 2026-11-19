import pathlib, subprocess as sp, json, hashlib, os, re
p=pathlib.Path(__file__).parent
cwd=pathlib.Path.cwd()
def git(*args): return sp.check_output(['git',*args]).decode().strip()
def blob(ref,path): return sp.check_output(['git','show',f'{ref}:{path}'])
def sha(data): return hashlib.sha256(data).hexdigest()
def write(name,data): (p/name).write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
def tree(ref): return {r.split('\t',1)[1]:r.split('\t',1)[0].split() for r in git('ls-tree','-r',ref).splitlines()}
expected=json.loads((p/'expected-map.json').read_text())
candidate=git('rev-parse','HEAD'); actual=tree(candidate)
assert actual==expected['expectedMap']
root=expected['root']; incoming=expected['incoming']; rootmap=expected['rootMap']; changed=set(expected['incomingPaths'])|{expected['manualRootOnlyAddition']['path']}
unrelated=[k for k in rootmap if k not in changed]
assert all(actual[k]==rootmap[k] for k in unrelated)
assert len(git('diff','--name-only',root,candidate).splitlines())==33
assert git('status','--porcelain=v1')==''
parents=git('show','-s','--format=%P',candidate).split(); assert parents==[root,incoming]
assert git('rev-parse',f'{candidate}^{{tree}}')==expected['expectedTree']
ledger=json.loads(blob(root,'docs/design/rollout-1692/integration.json'))
anchors=[{'issue':t['issue'],'verifiedCommit':t['verifiedCommit']} for t in ledger['tickets'] if t.get('verifiedCommit')]
anchors.insert(0,{'issue':ledger['baseline']['issue'],'verifiedCommit':ledger['baseline']['verifiedCommit']})
for a in anchors: a['ancestor']=sp.call(['git','merge-base','--is-ancestor',a['verifiedCommit'],candidate])==0
assert all(a['ancestor'] for a in anchors)
routes=json.loads(blob(root,'docs/design/rollout-1692/route-inventory.json'))
pages=[k for k in actual if k.startswith('apps/webapp/src/app/') and k.endswith('/page.tsx')]
assert len(pages)==172
archive=[k for k in rootmap if k.startswith(('docs/design/rollout-1692/1738/','docs/design/rollout-1692/1739/'))]
pins={}
configpaths=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','apps/webapp/package.json','apps/webapp/vitest.config.ts','apps/webapp/tsconfig.json','apps/webapp/tsconfig.typecheck.json','apps/webapp/tsconfig.workflow-contracts.json','apps/webapp/tsconfig.smoke.json','apps/webapp/biome.json','apps/webapp/next.config.ts']
sourcepaths=[k for k in changed if k.startswith('apps/')]+['apps/webapp/src/components/providers/organization-context-provider.tsx','apps/webapp/src/components/providers/view-refresh-provider.tsx','apps/webapp/src/components/header-refresh-button.tsx']
for k in sorted(set(configpaths+sourcepaths)):
    if k not in actual: continue
    pins[k]={'gitBlob':actual[k][2],'gitBytesSha256':sha(blob(candidate,k)),'workingBytesSha256':sha((cwd/k).read_bytes()),'rootBlob':rootmap.get(k,[None,None,None])[2]}
preservation={'candidate':candidate,'tree':expected['expectedTree'],'appTree':git('rev-parse',candidate+':apps/webapp'),'parents':parents,'expectedMapExact':True,'manualRootOnlyReconciliation':expected['manualRootOnlyAddition'],'recipe':expected['recipe'],'incomingPaths':32,'exactIncomingNonOverlapBlobs':31,'rootOnlyManualTestPaths':1,'totalCandidateDeltaPaths':33,'rootEntries':len(rootmap),'candidateEntries':len(actual),'allUnrelatedRootEntriesByteIdentical':len(unrelated),'rootPathsMissing':0,'trackedSourceDiffCheckPassed':sp.call(['git','-c','core.whitespace=cr-at-eol','diff',root,candidate,'--check'])==0,'verifiedTicketAnchorCount':len(anchors)-1,'baselineAnchorCount':1,'verifiedAnchors':anchors,'schedulingTeamArchivePathsPreserved':len(archive),'sourcePageTemplateCount':len(pages),'inheritedAliasCount':routes['counts']['redirectAliases'],'aliasesProof':'All root entries other than declared delta preserved; route inventory and alias paths unchanged. Runtime alias contracts not re-executed.','pins':pins,'root1740And1741':'Provisional sources/proofs/configs preserved by complete unrelated-root map equality. No readiness advancement.','latestVerified':'e7089f663f6f7b388472794f211fcb6e49e7911f','directBlockerF2':'382b8f5be837dad724d3a54274d3050b0104881f'}
write('preservation.json',preservation)
modules=[]; links=[]
for rel in ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']:
    d=cwd/rel; st=os.lstat(d)
    modules.append({'path':rel,'physical':not bool(getattr(st,'st_file_attributes',0)&0x400),'resolvedInsideOwnCheckout':os.path.commonpath([str(cwd),os.path.realpath(d)])==str(cwd)})
for rel in ['node_modules','apps/webapp/node_modules']:
    d=cwd/rel
    entries=[]
    for entry in d.iterdir():
        if entry.name.startswith('@'):
            entries.extend(entry.iterdir())
        else: entries.append(entry)
    for e in entries:
        if bool(getattr(os.lstat(e),'st_file_attributes',0)&0x400):
            resolved=os.path.realpath(e)
            links.append({'path':e.relative_to(cwd).as_posix(),'resolved':pathlib.Path(resolved).relative_to(cwd).as_posix() if os.path.commonpath([str(cwd),resolved])==str(cwd) else 'OUTSIDE','exists':e.exists()})
assert all(m['physical'] and m['resolvedInsideOwnCheckout'] for m in modules)
assert all(l['resolved']!='OUTSIDE' and l['exists'] for l in links)
sample=['apps/webapp/node_modules/react/package.json','apps/webapp/node_modules/vitest/package.json','apps/webapp/node_modules/@tanstack/react-query/package.json']
deps={'pnpmVersion':'12.16.1','guards':['pnpm_config_verify_deps_before_run=false','--config.verify-deps-before-run=false'],'installFlags':['--frozen-lockfile','--offline','--ignore-scripts','--package-import-method=copy'],'installPassed':True,'initialEngineStorePermissionFailureRetriedSameCommandWithNormalEscalation':True,'physicalDirectories':modules,'topLevelRootAndAppInternalLinkCount':len(links),'allLinkTargetsOwnAndExisting':True,'links':links,'samplePhysicalFileLinks':[{'path':s,'numberOfHardLinks':os.stat(cwd/s).st_nlink,'sha256':sha((cwd/s).read_bytes())} for s in sample],'lockSha256':pins['pnpm-lock.yaml']['workingBytesSha256'],'manifestLockConfigUnchanged':all(pins[k]['gitBlob']==pins[k]['rootBlob'] for k in pins if k in configpaths),'licenseCopied':False,'licenseLimit':'Not needed because first-critical stop precedes typegen/types; no license artifact copied/generated or fabricated.','peerDependenciesOrConfigBorrowed':False,'storeOrACLLockVersionWorkaround':False}
write('dependencies.json',deps)
incomingpublic=[k for k in expected['incomingPaths'] if k.startswith('docs/')]
write('incoming-public-preservation.json',{'scope':'Git blob preservation and inherited metadata only; no post-blocker artifact acceptance','files':[{'path':k,'blob':actual[k][2],'bytes':len(blob(candidate,k)),'sha256':sha(blob(candidate,k))} for k in incomingpublic], 'selectedJsonRead':['1742.md','after.json','verification.json','overlay.json','runtime.json','native.json','next-final.json'],'allIncomingPublicBlobsExact':True,'pngDecodedFresh':False,'limits':['Fresh full JSON/link/source-pin validation and PNG decode skipped at first-critical stop.','runtime-failed-attempt.png preserved byte-for-byte but never decoded/viewed.','No private drivers, profiles, raw action/RSC bodies or sessions followed.','Presentation/live/native source f5d3b34e2e388c87c278633e7bf8f2be71da5185 predates final bd426bd055c576f25098e152745c6580ff5f946d authority fence.','Historical comparison is partial four-consumer overlay, not full-checkout baseline. Preliminary mislabeled capture correction retained.']})
oldpaths=['apps/webapp/src/app/[locale]/(app)/team/period-submissions/page.tsx','apps/webapp/src/app/[locale]/(app)/team/period-submissions/period-submission-overview.tsx','apps/webapp/src/app/[locale]/(app)/team/period-submissions/period-submissions-data.ts']
write('premerge-classification.json',{'premerge':root,'fullPremergeTree':git('rev-parse',root+'^{tree}'),'files':[{'path':k,'premergeBlob':rootmap[k][2],'candidateBlob':actual[k][2]} for k in oldpaths],'classification':'Confirmed incoming implementation acceptance gap, not caused by metadata merge/test reconciliation: candidate client blob exactly equals incoming. Premerge is server-rendered snapshot without this local reader; source inspection finds no provider employee/role arrival fence there either. No executed same-seam historical comparison and no claim of new historical regression.','inherited':'Provider, refresh provider, canonical services and server access owners unchanged. Older route retained a server snapshot; its reactive employee/role behavior is unverified here.','limits':'Synthetic queued action transport does not prove live server revocation, atomic authorization, or a live exploit. Canonical action authorization remains server-owned.'})
summary={k:preservation[k] for k in ['candidate','tree','appTree','parents','rootEntries','candidateEntries','allUnrelatedRootEntriesByteIdentical','verifiedTicketAnchorCount','schedulingTeamArchivePathsPreserved','sourcePageTemplateCount']}
summary['internalLinks']=len(links)
print(json.dumps(summary,indent=2))
