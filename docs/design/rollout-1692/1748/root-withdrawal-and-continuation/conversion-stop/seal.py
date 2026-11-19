import hashlib, json, os, pathlib, subprocess
root=pathlib.Path.cwd()
base=root/'.tmp/review1748-independent'
safe=base/'SAFE'
os.environ['GIT_OPTIONAL_LOCKS']='0'
def git(*args): return subprocess.check_output(['git',*args],cwd=root)
def sha(data): return hashlib.sha256(data).hexdigest()
def dump(name,value): (safe/name).write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')

original=git('show','6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8:docs/design/rollout-1692/1748.md')
current=git('show','HEAD:docs/design/rollout-1692/1748.md')
assert current.startswith(original)
pres=json.loads((safe/'preservation.json').read_text())
pres.update({'originalReportExactGitPrefixPreserved':True,'originalReportGitBytes':len(original),'originalReportGitSha256':sha(original),'incomingArchiveAndReportPaths':75})
dump('preservation.json',pres)

receipt=json.loads((root/'docs/design/rollout-1692/1748/root-withdrawal-correction.json').read_text())
after=json.loads((safe/'pins-after.json').read_text())
for p in after['source']:
    expected=next(x for x in receipt['sourcePins'] if x['path']==p['path'])
    p['matchesProducerGitBlob']=p['gitBlob']==expected['blob']
assert all(p['matchesProducerGitBlob'] for p in after['source'])
dump('pins-after.json',after)

prefix="$env:pnpm_config_verify_deps_before_run='false'; "
commands=[
 {'name':'initial checkout pins','cwd':str(root),'command':'Get-Location; git status --short; git rev-parse HEAD; git rev-parse HEAD:apps/webapp; Get-Content AGENTS.md','exit':0,'result':'exact requested pins; tracked clean; Git global-ignore permission warning'},
 {'name':'restricted install attempt','cwd':str(root),'command':"New-Item -ItemType Directory -Path .tmp/review1748-independent/SAFE -Force | Out-Null; $env:pnpm_config_verify_deps_before_run='false'; pnpm --config.verify-deps-before-run=false --version; pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy 2>&1 | Tee-Object .tmp/review1748-independent/install.log; exit $LASTEXITCODE",'exit':1,'result':'engine-store operation lock denied; version-only fallback 12.21.0; no package import/test operation'},
 {'name':'escalated pinned install','cwd':str(root),'command':prefix+"$v = pnpm --config.verify-deps-before-run=false --version; if ($v -ne '12.16.1') { throw \"Required pnpm 12.16.1 unavailable: $v\" }; pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy 2>&1 | Tee-Object .tmp/review1748-independent/install-escalated.log; exit $LASTEXITCODE",'exit':0,'result':'12.16.1; 1823 copied offline packages; zero downloaded; no lifecycle'},
 {'name':'read issue (restricted)','cwd':str(root),'command':'gh issue view 1748 --repo Umami-Creative-GmbH/z8 --json number,title,body,state','exit':1,'result':'network socket permission denied'},
 {'name':'read issue (escalated)','cwd':str(root),'command':'gh issue view 1748 --repo Umami-Creative-GmbH/z8 --json number,title,body,state','exit':0,'result':'OPEN; R166 spec body read; no writes'},
 {'name':'priority suites','cwd':str(root),'command':prefix+'pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit src/components/travel-expenses/travel-expense-claim-withdrawal.test.tsx src/components/travel-expenses/legacy-draft-conversion-consumers.test.tsx src/components/travel-expenses/travel-expense-claim-detail.test.tsx --maxWorkers=1 --reporter=json --outputFile=../../.tmp/review1748-independent/priority.json *> .tmp/review1748-independent/priority.log; $result=$LASTEXITCODE; Write-Output "priority exit=$result"; exit $result','exit':0,'result':'36 passed/0 failed'},
 {'name':'prepare exact-owned bridges and pins','cwd':str(root),'command':'python .tmp/review1748-independent/prepare.py','exit':0,'result':'three bridges; exact baseline source plus one import adapter; source raw-byte mismatch qualified separately'},
 {'name':'independent conversion objection and controls','cwd':str(root),'command':prefix+'pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit src/test/review1748-independent-conversion.test.tsx --maxWorkers=1 --bail=1 --reporter=json --outputFile=../../.tmp/review1748-independent/conversion.json *> .tmp/review1748-independent/conversion.log; $result=$LASTEXITCODE; Write-Output "conversion exit=$result"; exit $result','exit':1,'result':'five controls passed; one settled P1; STOP'},
 {'name':'preservation and exact-owned bridge cleanup','cwd':str(root),'command':'python .tmp/review1748-independent/preserve.py','exit':0,'result':'42 distinct; 41 passed/1 failed; source/config unchanged; 74 archive files preserved; three exact-owned bridges removed; clean tracked/index/porcelain; prior 11 SAFE payload hashes matched'},
 {'name':'own process check (restricted)','cwd':str(root),'command':"$ownRoot = 'X:\\t3-code\\worktrees\\z8\\t3-f51581c5-204cc541b2d2fd45'; $matching = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(node|pnpm)(\\.exe)?$' -and $_.CommandLine -and $_.CommandLine.Contains($ownRoot) }); Write-Output \"ownNodePnpmProcessCount=$($matching.Count)\"; if ($matching.Count -ne 0) { exit 1 }",'exit':1,'result':'CIM access denied; no process count inferred'},
 {'name':'own process check (escalated)','cwd':str(root),'command':"$ownRoot = 'X:\\t3-code\\worktrees\\z8\\t3-f51581c5-204cc541b2d2fd45'; $matching = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(node|pnpm)(\\.exe)?$' -and $_.CommandLine -and $_.CommandLine.Contains($ownRoot) }); $receipt = @{ ownNodePnpmProcessCount=$matching.Count; inspected='Only node/pnpm command lines naming this isolated checkout; count-only output'; mutation='none' }; $receipt | ConvertTo-Json | Set-Content -Encoding UTF8 .tmp/review1748-independent/SAFE/process-cleanup.json; Write-Output \"ownNodePnpmProcessCount=$($matching.Count)\"; if ($matching.Count -ne 0) { exit 1 }",'exit':0,'result':'own node/pnpm count zero; no process mutated'},
 {'name':'public guidelines fetch','tool':'web.run','arguments':{'open':[{'ref_id':'https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md'}],'response_length':'short'},'exit':None,'result':'169-line primary-source guidelines fetched and consulted; no later broader UI acceptance claimed'},
 {'name':'seal owned public evidence','cwd':str(root),'command':'python .tmp/review1748-independent/seal.py','exit':0,'result':'index generated only after preservation, source/index cleanliness and public payload checks; separately printed index hash'}
]
# The literal Windows path and regex use a single backslash in PowerShell.
for item in commands:
    if item['name'].startswith('own process check'):
        item['command']=item['command'].replace('\\\\','\\').replace('\\"','"')
dump('commands.json',{'packageEnvironment':'pnpm_config_verify_deps_before_run=false','packageCliSetting':'--config.verify-deps-before-run=false','commands':commands,'additionalReadOnlyInspections':['AGENTS.md; docs/refs/agent-workflow.md; docs/refs/project-conventions.md; docs/refs/timekeeping.md; docs/refs/design-context.md; docs/agents/domain.md; docs/agents/issue-tracker.md; GLOSSARY-MAP.md; Travel Expenses CONTEXT.md','code-review, React Doctor, React best practices, composition and Web Interface Guidelines SKILL.md sources','docs/design/rollout-1692/1748.md; docs/design/rollout-1692/1748/root-withdrawal-correction.json; public manifest header; R166 versioned spec section','current detail/shared consumer/provider tests and production modules; exact baseline modules via git show; scope-limited git diff/stat/log','prior SAFE index/HANDOFF plus exactly the 11 allowlisted payload bytes; no directory traversal or archived script execution'],'readOnlyInspectionLimits':'Some initial batched Get-Content terminal output was truncated; no test result inferred from it. Exact acceptance commands/exits above are authoritative.'})

# Keep the actual setup/cleanup/sealing scripts as public reproducibility evidence.
for name in ['prepare.py','preserve.py','seal.py']:
    (safe/name).write_bytes((base/name).read_bytes())
assert git('rev-parse','HEAD').decode().strip()=='2404a1e0404e5079c56e51c290629455f798f9f5'
assert git('rev-parse','HEAD:apps/webapp').decode().strip()=='21de4ad559b7cfac4e8c168f8f7144f30e6780e5'
assert git('status','--porcelain=v1','--untracked-files=all').strip()==b''
proc=json.loads((safe/'process-cleanup.json').read_text(encoding='utf-8-sig'))
assert proc['ownNodePnpmProcessCount']==0
files=[]
for p in sorted(safe.iterdir()):
    assert p.is_file()
    data=p.read_bytes()
    if p.suffix=='.json': json.loads(data.decode('utf-8-sig'))
    files.append({'path':str(p),'bytes':len(data),'sha256':sha(data)})
index={'kind':'Explicit sanitized public allowlist; excluded-hash-only receipts are not audited public content','candidate':'2404a1e0404e5079c56e51c290629455f798f9f5','appTree':'21de4ad559b7cfac4e8c168f8f7144f30e6780e5','verifiedCommit':None,'review':'STOP first confirmed P1; review only; no release/readiness approval','files':files,'payloadCount':len(files),'payloadBytes':sum(x['bytes'] for x in files)}
data=(json.dumps(index,indent=2)+'\n').encode()
path=base/'SAFE-index.json'
path.write_bytes(data)
for item in files:
    content=pathlib.Path(item['path']).read_bytes()
    assert len(content)==item['bytes'] and sha(content)==item['sha256']
print(json.dumps({'safeIndex':str(path),'bytes':len(data),'sha256':sha(data),'payloads':len(files),'payloadBytes':index['payloadBytes'],'reportSha256':sha((safe/'REPORT.md').read_bytes()),'handoffSha256':sha((safe/'HANDOFF.md').read_bytes()),'sourceAndIndex':'clean','ownActiveResources':0}))
