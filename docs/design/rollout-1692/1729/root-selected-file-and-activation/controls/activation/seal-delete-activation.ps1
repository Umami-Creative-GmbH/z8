$ErrorActionPreference='Stop'
$repo1729=[IO.Path]::GetFullPath((Get-Location).Path)
$out1729=Join-Path $repo1729 '.tmp/1729-root-checks/acceptance'
$head1729=(git rev-parse HEAD).Trim()
if($head1729 -ne 'ed1841d161a448561b329fae43903b0a2e606dfa'){throw 'Source HEAD changed'}
$status1729=@(git status --porcelain)
if($status1729.Count){throw 'Checkout changed'}
$dependencies1729=Get-Content docs/design/rollout-1692/1728/root-lifecycle-and-snapshot/dependency-proof.json -Raw | ConvertFrom-Json
$links1729=@()
foreach($link1729 in $dependencies1729.links){
 $item1729=Get-Item -LiteralPath (Join-Path $repo1729 $link1729.path) -Force
 $target1729=[IO.Path]::GetFullPath([string]$item1729.Target[0])
 $expected1729=[IO.Path]::GetFullPath((Join-Path $repo1729 $link1729.target))
 if($target1729 -ne $expected1729 -or -not $target1729.StartsWith($repo1729+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Dependency link changed'}
 $links1729+=@{path=$link1729.path;target=$link1729.target;matches=$true}
}
if($links1729.Count -ne 158){throw 'Dependency link count changed'}
foreach($physical1729 in $dependencies1729.physicalRoots){if((Get-Item -LiteralPath $physical1729 -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Physical dependency root changed'}}
$preserved1729=Get-Content .tmp/merge1729-audit/preservation.json -Raw | ConvertFrom-Json
$config1729=@()
foreach($item1729 in $preserved1729.configuration){$hash1729=(Get-FileHash -LiteralPath $item1729.path -Algorithm SHA256).Hash.ToLowerInvariant();if($hash1729 -ne $item1729.sha256){throw 'Configuration changed'};$config1729+=@{path=$item1729.path;sha256=$hash1729;matches=$true}}
$proofs1729=@()
foreach($item1729 in $preserved1729.proofGroups.PSObject.Properties){
 $paths1729=@(git ls-files -- $item1729.Name)
 $diff1729=@(git diff --name-only e1e25677696ad9dce26b77e1fcb7047db8b2fe1c HEAD -- $item1729.Name)
 if($diff1729.Count -ne 0 -or $paths1729.Count -ne $item1729.Value){throw 'Prior proof changed'}
 $proofs1729+=@{path=$item1729.Name;files=$paths1729.Count;unchanged=$true}
}
$pins1729=@()
foreach($path1729 in @('apps/webapp/src/components/personnel-file/delete-document-dialog.tsx','apps/webapp/src/components/personnel-file/delete-document-dialog.test.tsx','apps/webapp/src/components/personnel-file/employee-file-workspace.tsx','apps/webapp/src/app/[locale]/(app)/personnel-files/[employeeId]/page.tsx','apps/webapp/src/components/personnel-file/use-personnel-files-snapshot.ts')){$pins1729+=@{path=$path1729;sha256=(Get-FileHash -LiteralPath $path1729 -Algorithm SHA256).Hash.ToLowerInvariant()}}
$artifacts1729=@()
foreach($file1729 in Get-ChildItem -LiteralPath $out1729 -File){if($file1729.Name -ne 'delete-activation-handoff.json'){$artifacts1729+=@{file=$file1729.Name;sha256=(Get-FileHash -LiteralPath $file1729.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$file1729.Length}}}
$result1729=Get-Content (Join-Path $out1729 'delete-activation-02.json') -Raw | ConvertFrom-Json
if($result1729.numPassedTests -ne 1 -or $result1729.numFailedTests -ne 2){throw 'Probe count changed'}
$record1729=@{
 status='SOURCE_BLOCKED';head=$head1729;branch=(git branch --show-current).Trim();trackedClean=$true;sourcePins=$pins1729;
 cases=@{passed=1;failed=2;physicalFiles=1;skipped=0};
 assertion='Both retired-task tests first assert zero action calls immediately after the public Delete click; after parent-clear or Activity hide/show and 30ms async drain, each observes one obsolete delete action. Current confirmation exact-payload control passes.';
 versions=@{react='19.3.1';tanstackReactForm='1.33.5';vitest='5.1.0'};
 seam='Real exported DeleteDocumentDialog, real TanStack form and actual Radix primitives; mocked public server action and translations only. Synthetic non-secret metadata. No browser/server authorization assertion.';
 command='$env:pnpm_config_verify_deps_before_run=''false''; pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --config ../../.tmp/1729-root-checks/acceptance/delete-activation.config.ts --project unit --maxWorkers 1 --reporter=json --outputFile=X:/t3-code/worktrees/z8/t3-36de3f4a-69b59b59b97cbc3d/.tmp/1729-root-checks/acceptance/delete-activation-02.json';
 attempts=@('delete-activation-01.json: initial same-turn tests; initial output path resolved outside repo and exact result copied back without alteration','delete-activation-02.json: strengthened zero-call-before-retirement assertion; same 1 pass / 2 fail');
 dependencies=@{physicalLinks=$links1729.Count;links=$links1729;physicalRootsPreserved=$true};configuration=$config1729;priorProofs=$proofs1729;
 deferred=@('nine PostgreSQL suites','isolated generated fixture and normal sign-in','public grant/revoke and late metadata Save','binary upload/download/ZIP/delete','phone self/officer long-title and saved18 controls','native React introspection and live Next MCP','matched before/current screenshots');
 cleanup=@{fixtureCreated=$false;containersStarted=0;NextStarted=$false;browserStarted=$false;overlayApplied=$false;backgroundProcessesStarted=0;allFiniteCommandsEnded=$true};
 artifactHashes=$artifacts1729;releasedUtc=[DateTimeOffset]::UtcNow.ToString('o');ownership='RELEASED: checkout/index/package/runtime/process';
}
[IO.File]::WriteAllText((Join-Path $out1729 'delete-activation-handoff.json'),($record1729|ConvertTo-Json -Depth 10))
Write-Output 'Sealed SOURCE_BLOCKED: 1 control passed, 2 retirement tests failed; clean source, 158 dependency links and six configuration hashes preserved.'
