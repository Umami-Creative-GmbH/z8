from review import *
import re, ast
before=json.loads((SAFE/'pins-before.json').read_text()); after=json.loads((SAFE/'pins-after.json').read_text())
assert git('rev-parse','HEAD')==before['head'] and git('rev-parse','HEAD:apps/webapp')==before['appTree'] and git('status','--short')==''
index=pathlib.Path(git('rev-parse','--git-path','index')); index=index if index.is_absolute() else ROOT/index
assert digest(index.read_bytes())==before['indexSha256']
for f in before['files']: assert digest((ROOT/f['path']).read_bytes())==f['sha256']
bridges=json.loads((SAFE/'bridges.json').read_text()); assert len(bridges)==7
for e in bridges: assert not (ROOT/e['path']).exists() and digest((SAFE/pathlib.Path(e['path']).name).read_bytes())==e['sha256']
shim=OUT/'bin/pnpm'; expected=b'#!/usr/bin/env bash\nexec /c/Users/KaiHentschel/AppData/Local/pnpm/bin/pnpm --config.verify-deps-before-run=false "$@"\n'
expected=expected.replace(b'\n',b'\r\n')
assert shim.resolve().is_relative_to(OUT) and shim.read_bytes()==expected
(SAFE/'nested-pnpm-bridge.sh').write_bytes(expected); shim.unlink(); shim.parent.rmdir()
processReceipt=OUT/'processes-final.json'; processRaw=processReceipt.read_bytes() if processReceipt.exists() else b''
assert not processRaw.strip() or json.loads(processRaw) in [None,[]]
service=json.loads((SAFE/'service-cleanup.json').read_bytes().decode('utf-8-sig')); assert service['remaining']==0 and service['exit']==0
save('cleanup.json',dict(sourceBridges=len(bridges),sourceBridgesAbsent=True,nestedPnpmBridgeAbsent=True,nestedBridgeSha256=digest(expected),ownedProcessMatches=0,processCheck='Elevated CIM check of node/python/bash commands naming this checkout; no matches',service=service,activeExactOwnedResources=0,persistentBrowserNextNativeCreated=0,staticOwnedDependencies='Retained only in isolated checkout; not borrowed, shared or active runtime',rootPeerCleanup=False,verifiedCommit=None))
attempts=[
 dict(attempt='restricted GitHub issue/spec read',outcome='Socket permission denial; escalated read succeeded; read-only'),
 dict(attempt='restricted pnpm --version',outcome='Engine-store permission denial printed fallback 12.21.0. No package execution used fallback. Elevated guard confirmed 12.16.1.'),
 dict(attempt='first Python pnpm launcher',outcome='WinError 2 before package execution. Explicit pnpm.cmd lookup fixed only launcher.'),
 dict(attempt='priority-objections',outcome='27 pass/1 failed assertion/3 bailed pending in actual records. Review test clicked Retry before its outage state committed; no product finding.'),
 dict(attempt='shell inline edit',outcome='Quoting caused Python SyntaxError; no files changed. The following priority-objections-settled reran unchanged source: 4 pass/1 same failure/3 pending.'),
 dict(attempt='priority-objections-waited',outcome='4 pass/1 harness failure/3 pending. Family refresh consumed finite conversion mock values concurrently. Preserved attempt2 source; persistent outage until deliberate recovery fixed the test seam. Final 8 objections pass.'),
 dict(attempt='restricted Docker availability probe',outcome='Docker pipe permission denied; authorized canonical disposable runner then succeeded.'),
 dict(attempt='optional restricted CIM process inventory',outcome='Permission denied. Final elevated exact checkout process check succeeded with zero matches.'),
 dict(attempt='optional Pillow availability probe',outcome='Module absent. No installation. PNG CRC, decompression and scanline filter reconstruction used standard library; all18 visually inspected.'),
 dict(attempt='quality/types launcher console',outcome='cp1252 UnicodeEncodeError after successful lint and typegen and after recorded explicit-format exit1. Completed receipts/logs retained. Console handling fixed; remaining commands resumed without rerunning completed checks.'),
 dict(attempt='main TypeScript',outcome='Exit1, only missing ignored licenses.json TS2307. No artifact copied/generated; not accepted as green.'),
 dict(attempt='format profiles',outcome='Explicit whole-scope two metadata findings; ordinary owned two findings. Separate two-file explicit100CRLF passes. No fixes or suppressions.'),
 dict(attempt='TypeScript JS parser API',outcome='Installed TypeScript7 native package has no expected ScriptTarget/CreateSourceFile JS API. Failed before parsing; installed Babel TSX parser completed22files zero diagnostics.'),
 dict(attempt='report prefix check',outcome='Initial assertion used LF Git blob against materialized CRLF byte receipt. Rechecked actual materialized bytes; both exact prefix hashes match. No report edit.'),
 dict(attempt='pnpm bridge cleanup guard',outcome='First seal expected LF instead of the known Windows text-write CRLF bytes. Guard refused deletion. Exact expected materialized CRLF bytes then matched before deletion.'),
 dict(attempt='optional status reads',outcome='A not-yet-written buffered log and a missing README/path probe printed read diagnostics. Later final receipts exist; no product/config mutation.'),
 dict(attempt='known Vite config warning',outcome='Current native config-loader compatibility warning retained. No suppressing environment flag set.'),
]
save('attempts.json',attempts)
save('setup-command.json',dict(environment={'pnpm_config_verify_deps_before_run':'false'},versionGuard="if ((pnpm --config.verify-deps-before-run=false --version) -ne '12.16.1') { throw 'Pinned pnpm required' }",install="pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy",exit=0,downloads=0,pnpm='12.16.1',lifecycleScripts=False,lockSha256=digest((ROOT/'pnpm-lock.yaml').read_bytes()),nestedBridge='nested-pnpm-bridge.sh',installationScope='Prepared isolated checkout only',verifiedCommit=None))
commands=json.loads((SAFE/'commands.json').read_text()); labels={x['label']:x for x in commands}
for p in SAFE.glob('*.command.json'):
 e=json.loads(p.read_text()); labels[e['label']]=e
save('commands.json',list(labels.values()))
save('findings.json',dict(standards=[],spec=[],confirmedP1=0,priorDetailFinding='Incomplete new withdrawal guarantee over inherited retention; corrected reproduction passes',priorConversionFinding='Incoming presentation regression over inherited cache retention; corrected reproduction and pinned controls pass',liveAuthorizationBypassEstablished=False,mainTypes='Qualified missing ignored license artifact',verifiedCommit=None))
# SAFE contains sanitized receipts and public synthetic tests, never raw test results/logs or archived pictures.
excluded=[]
for p in sorted(OUT.iterdir()):
 if p.is_file() and (p.suffix in ['.log','.json']) and p.name not in ['SAFE-index.json','seal-verification.json']:
  b=p.read_bytes(); excluded.append(dict(name=p.name,bytes=len(b),sha256=digest(b),contentAudited=False,classification='Excluded raw output; hash-only receipt, not public audited content'))
save('excluded-hash-only.json',excluded)
for name in ['review.py','prepare_objections.py','prepare_broader.py','prepare_refresh.py','checks.py','audit.py','account.py','release_bridges.py','syntax.cjs','seal.py']:
 (SAFE/name).write_bytes((OUT/name).read_bytes())
for p in SAFE.iterdir():
 if p.suffix=='.json': json.loads(p.read_bytes().decode('utf-8-sig'))
 if p.suffix=='.py': ast.parse(p.read_text())
 # Public test fixtures may use synthetic IDs. Private email/account/header/body inventories are never copied.
 if p.suffix in ['.json','.md','.tsx','.txt','.py','.cjs','.sh']:
  assert not re.search(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',p.read_text(encoding='utf-8-sig')),p.name
files=[]
for p in sorted(SAFE.iterdir()):
 assert p.is_file(); b=p.read_bytes(); files.append(dict(path=str(p),bytes=len(b),sha256=digest(b)))
indexData=dict(kind='Explicit sanitized public allowlist; excluded hash-only entries are not audited public content',head=before['head'],appTree=before['appTree'],verifiedCommit=None,review='Independent bounded review; no confirmed new P1; no readiness verdict',files=files,payloadCount=len(files),payloadBytes=sum(x['bytes'] for x in files))
target=OUT/'SAFE-index.json'; target.write_text(json.dumps(indexData,indent=2)+'\n',encoding='utf-8')
for x in files:
 p=pathlib.Path(x['path']); assert len(p.read_bytes())==x['bytes'] and digest(p.read_bytes())==x['sha256']
verification=dict(index=str(target),indexSha256=digest(target.read_bytes()),payloads=len(files),payloadBytes=indexData['payloadBytes'],allBytesAndHashesVerified=True,headUnchanged=True,indexUnchanged=True,sourceConfigEvidenceUnchanged=True,trackedStatusClean=True,activeExactOwnedResources=0,verifiedCommit=None)
(OUT/'seal-verification.json').write_text(json.dumps(verification,indent=2)+'\n')
print(json.dumps(verification))
