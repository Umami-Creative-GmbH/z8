import collections, hashlib, json, os, pathlib, subprocess
root=pathlib.Path.cwd()
base=root/'.tmp/review1748-independent'
safe=base/'SAFE'
os.environ['GIT_OPTIONAL_LOCKS']='0'
def git(*args):
    return subprocess.check_output(['git',*args],cwd=root)
def sha(data): return hashlib.sha256(data).hexdigest()
def dump(name,value): (safe/name).write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
def getmap(commit, *paths):
    result={}
    for entry in git('ls-tree','-r','-z',commit,'--',*paths).split(b'\0'):
        if not entry: continue
        meta,path=entry.split(b'\t',1)
        result[path.decode()] = meta.decode()
    return result

results=[]
for name in ['priority','conversion']:
    raw=json.loads((base/(name+'.json')).read_text(encoding='utf-8-sig'))
    tests=[]
    occurrence=collections.Counter()
    for suite in raw['testResults']:
        path=pathlib.Path(suite['name']).relative_to(root).as_posix()
        for case in suite['assertionResults']:
            key=(path,case['fullName'])
            occurrence[key]+=1
            tests.append({'file':path,'fullname':case['fullName'],'occurrence':occurrence[key],'status':case['status']})
    results.append({'run':name,'exit':0 if name=='priority' else 1,'tests':tests,'passed':raw['numPassedTests'],'failed':raw['numFailedTests']})
latest={}
for run in results:
    for case in run['tests']: latest[(case['file'],case['fullname'],case['occurrence'])]=case
dump('test-multiset.json',{'runs':results,'deduplication':'physical file/fullname/occurrence; reruns nonadditive; no historical worker/root counts added','distinct':len(latest),'latestPassed':sum(x['status']=='passed' for x in latest.values()),'latestFailed':sum(x['status']=='failed' for x in latest.values()),'physicalTestFiles':len({x['file'] for x in latest.values()}),'failedPredicate':{'reportLinkVisible':{'expected':False,'actual':True}},'stop':'First confirmed P1; no subsequent product acceptance runs'})

before=json.loads((safe/'pins-before.json').read_text())
after={'candidate':git('rev-parse','HEAD').decode().strip(),'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'appTree':git('rev-parse','HEAD:apps/webapp').decode().strip(),'config':[],'source':[],'dependencyTopology':[]}
for group in ['config','source']:
    for p in before[group]:
        data=(root/p['path']).read_bytes()
        item={'path':p['path'],'bytes':len(data),'sha256':sha(data),'unchangedSinceBefore':sha(data)==p['sha256']}
        if group=='source':
            blob=git('show','HEAD:'+p['path'])
            item['gitBlob']=git('rev-parse','HEAD:'+p['path']).decode().strip()
            item['gitBytes']=len(blob)
            item['gitSha256']=sha(blob)
            item['worktreeEqualsPinnedBlobAfterCRLFNormalization']=data.replace(b'\r\n',b'\n')==blob.replace(b'\r\n',b'\n')
        after[group].append(item)
for path in ['node_modules','apps/webapp/node_modules','apps/webapp/node_modules/react','apps/webapp/node_modules/react-dom','apps/webapp/node_modules/@tanstack/react-query','apps/webapp/node_modules/vitest','node_modules/react-doctor']:
    p=root/path
    resolved=p.resolve()
    after['dependencyTopology'].append({'path':path,'resolved':str(resolved),'insideOwnWorktree':resolved.is_relative_to(root),'isReparsePoint':bool(p.lstat().st_file_attributes & 1024)})
assert before['candidate']==after['candidate']
assert before['appTree']==after['appTree']
assert all(x['unchangedSinceBefore'] for g in ['source','config'] for x in after[g])
assert all(x['worktreeEqualsPinnedBlobAfterCRLFNormalization'] for x in after['source'])
dump('pins-after.json',after)
for file in ['legacy-draft-conversion.tsx','travel-expense-claim-detail.tsx']:
    (safe/('candidate-'+file+'.txt')).write_bytes(git('show','HEAD:apps/webapp/src/components/travel-expenses/'+file))

paths=['docs/design/rollout-1692/1748.md','docs/design/rollout-1692/1748']
original=getmap('6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8',*paths)
current=getmap('HEAD',*paths)
archive={k:v for k,v in original.items() if k!='docs/design/rollout-1692/1748.md'}
mismatches=[k for k,v in archive.items() if current.get(k)!=v]
dump('preservation.json',{'headAndAppTreeUnchanged':True,'sourceAndConfigUnchanged':True,'incomingArchivePaths':len(archive),'incomingArchiveMismatches':mismatches,'archiveVerification':'Git blob/mode equality only; stopped before content/link/image audit','reportChangedByPriorRootReceipt':'docs/design/rollout-1692/1748.md','protected63AnchorsPlusBaseline':'Inherited root receipts; full unchanged HEAD/index/worktree preserves those paths; no fresh functional acceptance claimed','verifiedCommit':None})

# Read only exactly listed payloads. Never traverse the earlier worktree or execute its scripts.
prior=pathlib.Path('X:/t3-code/worktrees/z8/t3-ef083329-83fb3c23a4ea5691/.tmp/review1748/SAFE-index.json')
indexbytes=prior.read_bytes()
assert sha(indexbytes)=='649fd83ba7378d7c087466887f7f67159f09d52988e16161825c644b788cc197'
audit=[]
for entry in json.loads(indexbytes)['files']:
    data=pathlib.Path(entry['path']).read_bytes()
    assert len(data)==entry['bytes'] and sha(data)==entry['sha256']
    audit.append({'name':pathlib.Path(entry['path']).name,'bytes':len(data),'sha256':sha(data),'hashVerified':True,'executed':False})
assert len(audit)==11 and sum(x['bytes'] for x in audit)==103566
dump('prior-safe-receipt.json',{'indexSha256':sha(indexbytes),'payloads':audit,'auditedBytes':sum(x['bytes'] for x in audit),'boundary':'Only allowlisted public bytes read and hashed; no private traversal; no archived scripts executed; no renewed historical acceptance'})

cleanup=[]
for bridge in json.loads((safe/'bridges.json').read_text()):
    p=root/bridge['path']
    assert p.is_relative_to(root)
    data=p.read_bytes()
    assert sha(data)==bridge['sha256'] and len(data)==bridge['bytes']
    p.unlink()
    cleanup.append({'path':bridge['path'],'bytes':len(data),'sha256':sha(data),'hashMatchedBeforeRemoval':True,'absentAfter':not p.exists()})
dump('bridge-cleanup.json',cleanup)
subprocess.run(['git','diff','--exit-code'],cwd=root,check=True)
subprocess.run(['git','diff','--cached','--exit-code'],cwd=root,check=True)
status=git('status','--porcelain=v1','--untracked-files=all').decode().strip()
assert status=='',status
dump('cleanup.json',{'trackedDiffExit':0,'indexDiffExit':0,'porcelain':'clean','temporaryBridgesRemoved':len(cleanup),'dockerServicesCreated':0,'serversCreated':0,'browsersCreated':0,'nativeSessionsCreated':0,'runtimeDownloads':0,'rootOrPeerMutations':0,'dependencyCopyRetainedLocally':True,'packageProcesses':'All own foreground install/test commands exited; final process count recorded separately','ownership':'Review integration/Git/index/package/runtime ownership released; no changes committed or published'})
excluded=[]
for name in ['install.log','install-escalated.log','priority.log','priority.json','conversion.log','conversion.json']:
    p=base/name
    data=p.read_bytes()
    excluded.append({'name':name,'bytes':len(data),'sha256':sha(data),'allowlistedPublicContent':False,'reason':'Raw runner/install output excluded. Hash-only receipt; not audited sanitized public content.'})
dump('excluded-hash-only.json',excluded)
print(json.dumps({'distinct':len(latest),'passes':sum(x['status']=='passed' for x in latest.values()),'failures':sum(x['status']=='failed' for x in latest.values()),'archivesPreserved':len(archive),'archiveMismatches':len(mismatches),'bridgesRemoved':len(cleanup),'status':status or 'clean','priorAllowlistedBytes':sum(x['bytes'] for x in audit)}))
