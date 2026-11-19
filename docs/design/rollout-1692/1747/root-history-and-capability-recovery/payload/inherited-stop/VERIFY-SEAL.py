import pathlib,json,hashlib
s=pathlib.Path(__file__).resolve().parent
index=json.loads((s/'SHA256.json').read_text(encoding='utf-8'))
assert len({r['path'] for r in index['files']})==len(index['files'])
for r in index['files']:
 p=s/r['path']; assert p.is_relative_to(s) and not p.is_symlink()
 raw=p.read_bytes(); assert len(raw)==r['bytes'] and hashlib.sha256(raw).hexdigest()==r['sha256'],r['path']
actual={p.relative_to(s).as_posix() for p in s.rglob('*') if p.is_file()}
assert actual=={r['path'] for r in index['files']}|{'SHA256.json'}
print(json.dumps({'status':'PASS','files':len(index['files']),'bytes':sum(r['bytes'] for r in index['files']),'verifiedCommit':None}))
