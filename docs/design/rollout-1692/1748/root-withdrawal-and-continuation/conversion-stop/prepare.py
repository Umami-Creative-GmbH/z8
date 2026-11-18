import hashlib, json, pathlib, subprocess

root = pathlib.Path.cwd()
safe = root / '.tmp/review1748-independent/SAFE'
candidate = '2404a1e0404e5079c56e51c290629455f798f9f5'
baseline = '85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4'
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
def hashbytes(data):
    return hashlib.sha256(data).hexdigest()
def receipt(path):
    p = root / path
    data = p.read_bytes()
    return dict(path=path, bytes=len(data), sha256=hashbytes(data))
assert git('rev-parse','HEAD').decode().strip() == candidate
assert git('rev-parse','HEAD:apps/webapp').decode().strip() == '21de4ad559b7cfac4e8c168f8f7144f30e6780e5'
bridges=[]
stem='apps/webapp/src/components/travel-expenses/'
for name in ['legacy-draft-conversion.tsx','travel-expense-claim-detail.tsx']:
    original = git('show',f'{baseline}:{stem}{name}')
    (safe / ('baseline-'+name+'.txt')).write_bytes(original)
    transformed = original
    target = stem + ('review1748-independent-baseline-conversion.tsx' if name.startswith('legacy') else 'review1748-independent-baseline-detail.tsx')
    if name.startswith('travel'):
        old = b'"./legacy-draft-conversion"'
        assert original.count(old)==1
        transformed = original.replace(old,b'"./review1748-independent-baseline-conversion"')
    assert not (root/target).exists()
    (root/target).write_bytes(transformed)
    bridges.append({**receipt(target),'originalBlob':git('rev-parse',f'{baseline}:{stem}{name}').decode().strip(), 'originalSha256':hashbytes(original),'adaptation':'one relative import redirected to exact pinned conversion source' if name.startswith('travel') else 'none; byte exact'})
target='apps/webapp/src/test/review1748-independent-conversion.test.tsx'
assert not (root/target).exists()
(root/target).write_bytes((safe/'conversion-review.test.tsx').read_bytes())
bridges.append(receipt(target))
(safe/'bridges.json').write_text(json.dumps(bridges,indent=2)+'\n',encoding='utf-8')
config=['pnpm-lock.yaml','package.json','pnpm-workspace.yaml','apps/webapp/package.json','apps/webapp/vitest.config.ts','apps/webapp/biome.json','apps/webapp/tsconfig.typecheck.json','apps/webapp/tsconfig.workflow-contracts.json','apps/webapp/tsconfig.smoke.json']
config=[x for x in config if (root/x).exists()]
pins = {'candidate':candidate,'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'appTree':git('rev-parse','HEAD:apps/webapp').decode().strip(),'baseline':baseline,'source':[], 'config': [receipt(x) for x in config], 'dependencies':{'beforeInstall':'node_modules and apps/webapp/node_modules absent', 'install':'offline frozen ignore-scripts package-import-method=copy', 'pnpm':'12.16.1', 'packages':1823,'downloaded':0,'doctor':'0.9.22', 'rootNodeModulesReparsePoint':bool((root/'node_modules').lstat().st_file_attributes & 1024),'appNodeModulesReparsePoint':bool((root/'apps/webapp/node_modules').lstat().st_file_attributes & 1024)}}
for x in json.loads((root/'docs/design/rollout-1692/1748/root-withdrawal-correction.json').read_text())['sourcePins']:
    r=receipt(x['path'])
    r['blob']=git('rev-parse',f"HEAD:{x['path']}").decode().strip()
    r['matchesProducerBytes']=r['sha256']==x['sha256'] and r['bytes']==x['bytes']
    pins['source'].append(r)
(safe/'pins-before.json').write_text(json.dumps(pins,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'bridges':len(bridges),'pins':pins['appTree'],'sourceMatches':all(x['matchesProducerBytes'] for x in pins['source'])}))
