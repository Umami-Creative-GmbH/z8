import json,pathlib,hashlib,subprocess,os
s=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE'
prep=json.loads((s/'prep-hash-audit.json').read_text());assert prep['files']==61 and prep['bytes']==3109642
added=subprocess.check_output(['git','diff','--name-only','--diff-filter=A','-z','3a3c1243147d92213ffde7ffe423e3da67ecd011','bceb0ee32ca64e1d0fcf36906e89b0509665c479']).split(b'\0');assert len([p for p in added if p])==204
verifier='''import pathlib,json,hashlib
s=pathlib.Path(__file__).resolve().parent
index=json.loads((s/'SHA256.json').read_text(encoding='utf-8'))
assert len({r['path'] for r in index['files']})==len(index['files'])
for r in index['files']:
 p=s/r['path']; assert p.is_relative_to(s) and not p.is_symlink()
 raw=p.read_bytes(); assert len(raw)==r['bytes'] and hashlib.sha256(raw).hexdigest()==r['sha256'],r['path']
actual={p.relative_to(s).as_posix() for p in s.rglob('*') if p.is_file()}
assert actual=={r['path'] for r in index['files']}|{'SHA256.json'}
print(json.dumps({'status':'PASS','files':len(index['files']),'bytes':sum(r['bytes'] for r in index['files']),'verifiedCommit':None}))
'''
(s/'VERIFY-SEAL.py').write_text(verifier,encoding='utf-8')
# Explicit final source/index/resource receipt. No test execution after stop.
p=subprocess.run(['git','status','--porcelain'],capture_output=True);assert p.returncode==0 and not p.stdout.strip()
(s/'final-git-status.log').write_bytes(p.stdout+p.stderr)
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();assert head=='c70858bfe507eb99f844a455230e312cc8247b61'
files=[]
for p in sorted(s.rglob('*')):
 if not p.is_file() or p.name=='SHA256.json':continue
 raw=p.read_bytes();files.append({'path':p.relative_to(s).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
index={'schemaVersion':1,'verifiedCommit':None,'classification':'SAFE explicit public payloads; provisional review stopped at first confirmed P1','files':files,'fileCount':len(files),'totalBytes':sum(r['bytes'] for r in files)}
(s/'SHA256.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'index':str(s/'SHA256.json'),'sha256':hashlib.sha256((s/'SHA256.json').read_bytes()).hexdigest(),'files':len(files),'bytes':index['totalBytes']}))
