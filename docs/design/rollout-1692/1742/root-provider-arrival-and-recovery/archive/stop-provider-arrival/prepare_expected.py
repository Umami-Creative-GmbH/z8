import subprocess as sp, pathlib, json, hashlib, os
out=pathlib.Path(__file__).parent
root='7cf9871f8c782deb9ad279c9e2dfb5ed8e6fa60c'
incoming='cfa34ce7ed2ea0d2df23929f4656b7fefdcd8e29'
def git(*args, input=None, env=None):
    return sp.check_output(['git',*args],input=input,env=env)
def tree(ref):
    return {r.split('\t',1)[1]:r.split('\t',1)[0].split() for r in git('ls-tree','-r',ref).decode().splitlines()}
base=git('merge-base',root,incoming).decode().strip()
rt,it,bt=tree(root),tree(incoming),tree(base)
paths=git('diff','--name-only',base,incoming).decode().splitlines()
overlap=[p for p in paths if rt.get(p)!=bt.get(p)]
assert len(paths)==32 and overlap==['apps/webapp/src/lib/navigation/route-metadata.ts'],overlap
expected=dict(rt)
for p in paths:
    assert p in it
    expected[p]=it[p]
meta=overlap[0]
original=git('show',root+':'+meta)
anchor=b'\t\tpath === "/team/driving" ||\n'
assert original.count(anchor)==1
composed=original.replace(anchor,anchor+b'\t\tpath === "/team/period-submissions" ||\n')
test='apps/webapp/src/lib/navigation/route-metadata.test.ts'
original_test=git('show',root+':'+test)
old=b'"/en/team/period-submissions",'
assert original_test.count(old)==1
reconciled=original_test.replace(old,b'"/en/team/period-submissions/detail",')
for p,data,name in [(meta,composed,'expected-metadata.ts'),(test,reconciled,'expected-metadata.test.ts')]:
    (out/name).write_bytes(data)
    blob=git('hash-object','-w','--stdin',input=data).decode().strip()
    expected[p]=['100644','blob',blob]
idx=out.resolve()/'expected.index'
assert not idx.exists()
env={**os.environ,'GIT_INDEX_FILE':str(idx)}
git('read-tree',root,env=env)
for p in [*paths,test]:
    mode,_,blob=expected[p]
    git('update-index','--add','--cacheinfo',mode,blob,p,env=env)
expected_tree=git('write-tree',env=env).decode().strip()
data={'root':root,'incoming':incoming,'base':base,'incomingPathCount':len(paths),'incomingPaths':paths,'overlap':overlap,'manualRootOnlyAddition':{'path':test,'oldNegative':old.decode(),'newNegative':'"/en/team/period-submissions/detail",','reason':'Exact route now owns heading; deeper routes must remain excluded; all other tests byte-preserved.'},'recipe':'Root recursive map + 31 exact incoming nonoverlap blobs + root metadata with one exact route literal + authorized root-only negative reconciliation. Not a pure merge-tree match.','expectedTree':expected_tree,'expectedMap':expected,'rootMap':rt}
(out/'expected-map.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:v for k,v in data.items() if k not in ('expectedMap','rootMap','incomingPaths')},indent=2))
