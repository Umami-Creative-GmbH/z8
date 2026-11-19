import json, hashlib, pathlib, subprocess, os, sys, time, collections, shutil
sys.stdout.reconfigure(errors='backslashreplace')
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'.tmp/review1748-both'
SAFE=OUT/'SAFE'
SAFE.mkdir(parents=True,exist_ok=True)
def digest(b): return hashlib.sha256(b).hexdigest()
def save(n,v): (SAFE/n).write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT).decode().strip()
def pin(p):
 b=(ROOT/p).read_bytes(); return dict(path=p,bytes=len(b),sha256=digest(b),blob=git('rev-parse','HEAD:'+p))
def snapshot(n):
 receipt=json.loads((ROOT/'docs/design/rollout-1692/1748/root-conversion-withdrawal-correction.json').read_text())
 paths=[x['path'] for x in receipt['sourcePins']+receipt['frozenOwnerPins']]
 paths+=['pnpm-lock.yaml','pnpm-workspace.yaml','package.json','apps/webapp/package.json','apps/webapp/vitest.config.ts','apps/webapp/biome.jsonc','apps/webapp/tsconfig.json','apps/webapp/tsconfig.typecheck.json','apps/webapp/tsconfig.smoke.json','apps/webapp/tsconfig.workflow-contracts.json','docs/design/rollout-1692/1748.md']
 paths+=git('ls-files','docs/design/rollout-1692/1748').splitlines()
 index=pathlib.Path(git('rev-parse','--git-path','index'))
 if not index.is_absolute(): index=ROOT/index
 save(n,dict(head=git('rev-parse','HEAD'),appTree=git('rev-parse','HEAD:apps/webapp'),tree=git('rev-parse','HEAD^{tree}'),indexSha256=digest(index.read_bytes()),status=git('status','--short'),files=[pin(p) for p in sorted(set(paths))],dependencies=[dict(path=p,exists=(ROOT/p).exists(),symlink=(ROOT/p).is_symlink(),resolved=str((ROOT/p).resolve())) for p in ['node_modules','node_modules/.pnpm','apps/webapp/node_modules']],verifiedCommit=None))
def intake():
 p=pathlib.Path('X:/t3-code/worktrees/z8/t3-f51581c5-204cc541b2d2fd45/.tmp/review1748-independent/SAFE-index.json')
 b=p.read_bytes(); assert digest(b)=='864b3a5a1ab722fcc3fb63352c507c0dc6a4ed642b9df517b27178c78ff5e04a'
 index=json.loads(b); entries=[]
 for f in index['files']:
  q=pathlib.Path(f['path']); data=q.read_bytes(); assert len(data)==f['bytes'] and digest(data)==f['sha256']
  entries.append(dict(name=q.name,bytes=len(data),sha256=digest(data)))
  if q.name in ['conversion-review.test.tsx','baseline-legacy-draft-conversion.tsx.txt','baseline-travel-expense-claim-detail.tsx.txt']: (SAFE/q.name).write_bytes(data)
 save('prior-intake.json',dict(indexSha256=digest(b),payloads=entries,contentBoundary='Explicit 21 allowlisted payloads only; hash verification, no archived script execution.'))
def prepare():
 intake(); receipt=[]
 copies={'conversion-review.test.tsx':'apps/webapp/src/test/review1748-original-conversion.test.tsx','baseline-legacy-draft-conversion.tsx.txt':'apps/webapp/src/components/travel-expenses/review1748-independent-baseline-conversion.tsx','baseline-travel-expense-claim-detail.tsx.txt':'apps/webapp/src/components/travel-expenses/review1748-independent-baseline-detail.tsx'}
 for a,b in copies.items():
  target=ROOT/b; assert not target.exists(); data=(SAFE/a).read_bytes()
  if 'baseline-detail' in b: data=data.replace(b'"./legacy-draft-conversion"',b'"./review1748-independent-baseline-conversion"')
  target.write_bytes(data); receipt.append(dict(path=b,bytes=len(data),sha256=digest(data)))
 save('bridges.json',receipt)
def run(label,args,cwd=None):
 env=os.environ.copy(); env['pnpm_config_verify_deps_before_run']='false'
 command=[shutil.which('pnpm.cmd'),'--config.verify-deps-before-run=false',*args]
 start=time.time(); p=subprocess.run(command,cwd=cwd or ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (OUT/(label+'.log')).write_bytes(p.stdout)
 file=SAFE/'commands.json'; records=json.loads(file.read_text()) if file.exists() else []
 records.append(dict(label=label,cwd=str(cwd or ROOT),environment={'pnpm_config_verify_deps_before_run':'false'},argv=command,exit=p.returncode,seconds=round(time.time()-start,3),logBytes=len(p.stdout),logSha256=digest(p.stdout)))
 save(label+'.command.json',records[-1]); save('commands.json',records); print(json.dumps(records[-1])); print(p.stdout.decode(errors='replace')[-1800:]); return p.returncode
if __name__=='__main__':
 if sys.argv[1]=='snapshot': snapshot(sys.argv[2])
 elif sys.argv[1]=='prepare': prepare()
 elif sys.argv[1]=='run': sys.exit(run(sys.argv[2],sys.argv[3:]))
