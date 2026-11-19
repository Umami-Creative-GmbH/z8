import subprocess,json,pathlib,os
s=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE'
p=json.loads((s/'merge-prediction.json').read_text())
def git(*a):
 r=subprocess.run(['git',*a],capture_output=True); assert r.returncode==0,(a,r.stderr); return r.stdout.decode().strip()
assert git('branch','--show-current')=='review/r165-travel-expenses'
git('add','--','apps/webapp/src/lib/navigation/route-metadata.ts')
t=git('write-tree'); assert t==p['predictedTree'],(t,p)
git('commit','-m','Provisional R165 review merge of personal travel expenses (#1747)')
head=git('rev-parse','HEAD');actual={'commit':head,'tree':git('rev-parse','HEAD^{tree}'),'appTree':git('rev-parse','HEAD:apps/webapp'),'parents':git('show','-s','--format=%P','HEAD').split()}
assert actual['parents']==p['orderedParents'] and actual['tree']==p['predictedTree'] and actual['appTree']==p['predictedAppTree']
(s/'candidate.json').write_text(json.dumps(actual,indent=2));print(json.dumps(actual,indent=2))
