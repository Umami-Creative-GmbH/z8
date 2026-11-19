import subprocess,json,pathlib,hashlib,collections,os
SAFE=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE'
ROOT='bceb0ee32ca64e1d0fcf36906e89b0509665c479'; INC='4460bc433f99a7e9b3dc84862e9efedf72cbcf8a'; BASE='cab40dcbb6ea69cefb7aa919228298a881a66060'
commands=[]
def git(*args, data=None,ok=(0,)):
 p=subprocess.run(['git',*args],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 commands.append({'command':['git',*args],'exit':p.returncode,'stderr':p.stderr.decode(errors='replace')})
 (SAFE/'prep-commands.json').write_text(json.dumps(commands,indent=2))
 if p.returncode not in ok: raise RuntimeError(commands[-1])
 return p.stdout

def tree(ref):
 rows={}
 for x in git('ls-tree','-rz','--full-tree',ref).split(b'\0'):
  if not x: continue
  h,p=x.split(b'\t'); mode,typ,blob=h.decode().split();rows[p.decode()]=[mode,typ,blob]
 return rows
assert git('rev-parse','HEAD').decode().strip()==ROOT
assert git('status','--porcelain').strip()==b''
assert git('branch','--show-current').decode().strip()=='review/r165-travel-expenses'
assert git('rev-parse','HEAD:apps/webapp').decode().strip()=='1f82885d26e402a0d01556ea7005adba092e9cff'
r=tree(ROOT);b=tree(BASE);i=tree(INC); assert len(r)==18791
(SAFE/'root-baseline.json').write_text(json.dumps(r,indent=2))
prep=pathlib.Path(os.environ['TEMP'])/'z8-r165-after1748-readonly-prep-b_hzy4c3'
checks=[]
for row in json.loads((prep/'SHA256.json').read_text()):
 p=prep/row['path']; raw=p.read_bytes();checks.append({**row,'match':len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']})
assert all(x['match'] for x in checks)
(SAFE/'prep-hash-audit.json').write_text(json.dumps({'files':len(checks),'bytes':sum(x['bytes'] for x in checks),'checks':checks},indent=2))
ledger=json.loads(git('show',ROOT+':docs/design/rollout-1692/integration.json'))
anchors=[{'id':'baseline',**ledger['baseline']}]+[t for t in ledger['tickets'] if t.get('verifiedCommit')]
for a in anchors: a['ancestor']=len(git('merge-base','--is-ancestor',a['verifiedCommit'],ROOT))==0
assert len(anchors)==65
(SAFE/'anchors.json').write_text(json.dumps({'anchors':anchors,'nodes':len(ledger['tickets']),'edges':sum(len(t['blockedBy']) for t in ledger['tickets']),'statusCounts':dict(collections.Counter(t['status'] for t in ledger['tickets']))},indent=2))
rd={p for p in r.keys()|b.keys() if r.get(p)!=b.get(p)};id={p for p in i.keys()|b.keys() if i.get(p)!=b.get(p)}
assert rd&id=={'apps/webapp/src/lib/navigation/route-metadata.ts'} and len(id)==86
p=next(iter(rd&id)); raw=git('show',ROOT+':'+p);assert r[p][2]=='225e32211910e6e2a89504996134d7673e5d1ca4'
# Independent byte recipe: root plus only the exact listing equality before its legacy matcher.
needle=b'\t\tBoolean(legacyClaimId && z.uuid().safeParse(legacyClaimId).success)'
assert raw.count(needle)==1
resolved=raw.replace(needle,b'\t\tpath === "/travel-expenses" ||\n'+needle)
(SAFE/'resolved-route-metadata.ts').write_bytes(resolved)
def object_hash(kind, raw): return hashlib.sha1((kind+' '+str(len(raw))+'\0').encode()+raw).hexdigest()
blob=object_hash('blob',resolved)
expected=dict(r)
for path in id:
 if path!=p:
  if path in i:expected[path]=i[path]
  else:expected.pop(path,None)
expected[p]=[r[p][0],'blob',blob]
(SAFE/'expected-map.json').write_text(json.dumps(expected,indent=2))
def write_tree(rows):
 dirs={}; leaves=[]
 for p,entry in rows.items():
  if '/' in p:
   head,tail=p.split('/',1);dirs.setdefault(head,{})[tail]=entry
  else: leaves.append((p,entry))
 for name,sub in dirs.items(): leaves.append((name,['040000','tree',write_tree(sub)]))
 leaves.sort(key=lambda x: (x[0]+('/' if x[1][1]=='tree' else '')).encode())
 payload=b''.join((f'{int(mode)} {name}\0').encode()+bytes.fromhex(oid) for name,(mode,typ,oid) in leaves)
 return object_hash('tree',payload)
assert write_tree(r)==git('rev-parse',ROOT+'^{tree}').decode().strip()
predicted=write_tree(expected);app=write_tree({p[len('apps/webapp/'):]:x for p,x in expected.items() if p.startswith('apps/webapp/')})
summary={'root':ROOT,'incoming':INC,'base':BASE,'rootTree':git('rev-parse',ROOT+'^{tree}').decode().strip(),'rootEntries':len(r),'incomingChanged':len(id),'rootChanged':len(rd),'overlap':sorted(rd&id),'compositionBlob':blob,'predictedTree':predicted,'predictedAppTree':app,'orderedParents':[ROOT,INC],'entries':len(expected),'nativeMergeNotYetRun':True}
(SAFE/'merge-prediction.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
