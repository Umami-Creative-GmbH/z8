# C5 controller worksheet — unfrozen actual-root preparation

**Prepared, not frozen.** ROOT's new head CI completed successfully at `2026-10-25T02:58:23.067Z`: source `de0b1a128b384196c7c93ac69cd5324e8d0cbbd8`, CI true/two workers, started `2026-10-25T02:48:08.675Z`, exit zero. The offline helper then prepared the draft/NEW sidecar from actual clean integrated ROOT `b73e0fd631aa2546e5576271833dabaf13339a1c`, checking the exact record and all three source maps. No freeze, runtime admission or capture has run. ROOT must finish its scope/ingress runtime gates and release an exclusive quiet window; no app findings may remain unresolved.

Original binary is exact `456d28b2da4437662ae8f625a1df6756bff031fe`, business source `39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be`. [Policy7 and fresh original evidence](1450-observer-v8-proof-refresh.md) preserve all factors/floors and strict HEAD gates. The C5 execution condition retains settled warm prerequisites and adds quiet **inside** the existing measured mutation timer before its forced reload; restoration waits follow fixed snapshots. This is not identical execution to C1–C4. Primary CDP partial flags stay partial; complete body-byte gates require the matched companion. Optional prefetch errors are separate; mandatory errors/caps/unknowns/native inconsistency still fail.

The six-visit456 mutation diagnostic passed/restored all six, 21566 exact global queries. Earlier295 passed five and failed the large native cap; its cause remains UNKNOWN. Optional prefetch errors differed (four versus zero); additive SERVER diagnostics and the green456 run do not demonstrate a causal repair. All C1/C2/C3/C4 frozen plans, modules, raw/interrupted evidence and old proof bytes remain immutable. C5 uses NEW paths only.

The mutable `before-plan-c5-DRAFT.json` changes runtime only. Its non-runtime fields deeply equal original C1 SHA256 `3feed7ee263c08f522bc886c8390224abdbfa67926c4ff02d0fb50f3d30dabb3`: **114 / 1380 primary**, **54 / 1080 companion**, concurrency one, twenty fresh-context first documents/twenty repeat Links and five functional samples where declared. The preparation helper checked these counts and all three actual integrated source fingerprint maps. It updates only `runtime.toolingBuild`; it refuses pending/failed DE0 CI or changed app source. The freeze helper rechecks the record, source maps and ancestor pin. Doc-only integrations can leave the pin as an ancestor when every measuring byte still matches.

| Reviewed input | SHA256 |
| --- | --- |
| C5 draft | `cf0656f9bf8a498d642258769e21bcf056af31eaeea33c068244f36877adeae5` |
| `before-plan-c5-DRAFT-preparation-root-b73e0fd631aa2546e5576271833dabaf13339a1c-policy7.json` | `ad01331d57f09291255b7b84a5126610a60a8067ee5a1addcb5e57eabd1eba94` |
| `prepare-c5-draft.mjs` | `185e2f4580a9f0463990b50179286d2d6d4a197226d910cc3e10463b3720d807` |
| `freeze-c5-after-controller-release.mjs` | `04ed4282fcbac61b81a8a4cfa3d1f90f026158b45b8f94e2f07a5909886dfbb6` |
| `controller-admission-c5.mjs` | `9a18f30f30f156c2b8930a96301fa1e66e55ac4747eadb7709ea51e84579b8c1` |
| Successful DE0 head CI record | `5e0bd9767b1d5d124e0c5204a006332ed0e693c6e99dfcbca043bf34099f6cde` |
| Actual compiled required-server-files manifest | `876c31b0d96fb2123be97c8767fd28d1058981a4822ff55d30e93ccc451a1ac3` |

The helper files are new narrow copies; earlier helpers/frozen outputs are untouched. Node syntax and three worksheet PowerShell blocks parsed successfully. Offline preparation initially rejected a copied checksum literal before creating any output; that literal was corrected and the successful normal preparation retained the exact unchanged C1 hash. Freeze/admission remain unexecuted and `before-c5` is absent. ROOT admitted the actual full-DE0 manifest; its hash was also checked from disk. The shared BUILD_ID is insufficient to identify the new artifact. Reserve multi-hour windows; historical C1 sums are recorded intervals rather than wall time/ETA, and the new setup/measured quiet adds work. Never shrink counts or relax gates for scheduling.

## Reviewed inputs; ROOT releases freeze after functional gates

Run from the actual clean integrated checkout, never the preparation agent's line endings. The actual-root sidecar below is already prepared; do not overwrite it. File-based admission avoids the Windows pnpm multiline `node -e` argument bug.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$expectedHeadRecordSha256 = '5e0bd9767b1d5d124e0c5204a006332ed0e693c6e99dfcbca043bf34099f6cde'
$headRecord = Join-Path $scratch 'final-scope-binding-build-v1/head-build.json'
if ((Get-FileHash -LiteralPath $headRecord -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHeadRecordSha256) { throw 'Head CI admission pending or record changed.' }
Set-Location -LiteralPath $source
$prep = Join-Path $scratch 'before-plan-c5-DRAFT-preparation-root-b73e0fd631aa2546e5576271833dabaf13339a1c-policy7.json'
$run = Join-Path $scratch 'before-c5'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$collector = Join-Path $scratch 'performance-runtime/observer-v8/collector-control.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if ((Get-FileHash -LiteralPath $prep -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'ad01331d57f09291255b7b84a5126610a60a8067ee5a1addcb5e57eabd1eba94') { throw 'Reviewed preparation changed.' }
# Only on measuring-byte drift: run prepare-c5-draft.mjs into a NEW explicitly named sidecar, then review new hashes.
# pnpm --config.verifyDepsBeforeRun=false node "$scratch/prepare-c5-draft.mjs" $source $scratch "$scratch/before-plan-c5-DRAFT-preparation-NEWPIN.json" before-plan-c5-DRAFT.json
# STOP: ROOT reviews actual draft/sidecar hashes, head record and all three maps before freeze.
```

## ROOT-only freeze, file admission and original captures

```powershell
pnpm --config.verifyDepsBeforeRun=false node "$scratch/freeze-c5-after-controller-release.mjs" --execute-freeze $source $scratch $prep $run
if ($LASTEXITCODE -ne 0) { throw 'Freeze failed; preserve partial outputs.' }
$plan = Join-Path $run 'before-plan-c5.json'
$tools = Join-Path $run 'tooling/scripts/performance'
$primary = Join-Path $run 'primary'
$before = Join-Path $primary 'baseline.json'
$beforeNative = Join-Path $run 'primary-native.json'
$settled = Join-Path $run 'settled.json'
$settledNative = Join-Path $run 'settled-native.json'
Copy-Item -LiteralPath "$scratch/controller-admission-c5.mjs" -Destination "$run/controller-admission.mjs"
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'Frozen plan/source validation failed.' }
pnpm --config.verifyDepsBeforeRun=false node "$run/controller-admission.mjs" "$tools/run-baseline.mjs" "$tools/collector-client.mjs" $collector
if ($LASTEXITCODE -ne 0) { throw 'Frozen dependencies or native epoch not idle/balanced.' }
function Assert-NewOutput([string] $path) { if (Test-Path -LiteralPath $path) { throw "Output exists: $path" } }
function Export-CollectorMetrics([string] $controlPath, [string] $outputPath) {
  Assert-NewOutput $outputPath
  $control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
  $uri = [System.UriBuilder]::new([System.Uri]$control.endpoint)
  if ($control.kind -ne 'z8-fixture-otlp-collector-v2' -or $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1') { throw 'Require the owned registered v2 collector.' }
  $uri.Path = '/metrics'; $uri.Query = ''; $uri.Fragment = ''
  Invoke-WebRequest -Uri $uri.Uri -OutFile $outputPath | Out-Null
}
Assert-NewOutput $primary
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --auth $auth --chrome $chrome --collector $collector --out $primary *> "$run/primary-capture-private.log"
$captureExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($captureExit -ne 1 -or $raw.samples.Count -ne 1380 -or $raw.nativeRunCoverage.complete -ne $true) { throw 'Primary incomplete; preserve every failure.' }
Assert-NewOutput "$primary/baseline.raw.json"
Copy-Item -LiteralPath $before -Destination "$primary/baseline.raw.json"
Export-CollectorMetrics $collector $beforeNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --finalize $before --backend $beforeNative *> "$run/primary-finalize-private.log"
$finalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($finalizeExit -ne 0 -or $final.acceptance -ne 'baseline-recorded' -or $final.evidenceComplete -ne $true -or $final.evidenceGates.Count -ne 0) { throw 'Primary gates remain unfulfilled.' }
# Companion starts only after primary capture/finalization fully exit.
Assert-NewOutput $settled
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" capture --plan $plan --auth $auth --chrome $chrome --collector $collector --out $settled *> "$run/settled-capture-private.log"
$captureExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($captureExit -ne 1 -or $raw.samples.Count -ne 1080 -or $raw.nativeRunCoverage.complete -ne $true -or $raw.interrupted) { throw 'Companion incomplete; preserve every sample.' }
Assert-NewOutput "$run/settled.raw.json"
Copy-Item -LiteralPath $settled -Destination "$run/settled.raw.json"
Export-CollectorMetrics $collector $settledNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" finalize --plan $plan --artifact $settled --backend $settledNative *> "$run/settled-finalize-private.log"
$finalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($finalizeExit -ne 0 -or $final.evidenceComplete -ne $true -or $final.resourceComplete -ne $true) { throw 'Companion gates remain unfulfilled.' }
```

Capture exit **1** is expected for an unfinalized ledger; each finalizer must exit **0** with complete native/resource proof. Keep all raw failures, null usable percentiles, actual native paint/read coverage, per-trace close proof/elapsed time, prerequisite/reload/cleanup and transport counters. A complete failed-before resource observation qualifies only under exact456/business39 policy7; HEAD always requires all UI/resource gates. Original mixed writes follow **both** complete original captures. Ingress, mixed load, quality and final review remain separate release gates.

## Derive and register before controlled head timing

```powershell
$headBuildRecord = Get-Content -Raw -LiteralPath $headRecord | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $headRecord -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHeadRecordSha256) { throw 'Admitted CI record changed.' }
$prepared = Get-Content -Raw -LiteralPath "$run/preparation.json" | ConvertFrom-Json
$registered = Join-Path $run 'registered-release'
Assert-NewOutput $registered
pnpm --config.verifyDepsBeforeRun=false node "$tools/release-budgets.mjs" derive --before-plan $plan --before $before --backend $beforeNative --before-settled $settled --before-settled-backend $settledNative --release-build $headBuildRecord.source --release-source $headBuildRecord.source --release-tooling $prepared.toolingCommit --out $registered *> "$run/derive-private.log"
if ($LASTEXITCODE -ne 0) { throw 'Original evidence rejected; no registration.' }
$registration = [ordered]@{ kind = 'controller-release-budget-registration'; registeredAt = [DateTimeOffset]::UtcNow.ToString('O'); controlledHeadStarted = $false; numericalPolicyVersion = 7; frozenToolingCommit = $prepared.toolingCommit; policyProofSource = '4a617985a8758f67f5d888d0b65ef02af04e1c8b' }
foreach ($entry in @(@('planSha256',"$registered/release-plan.json"),@('budgetsSha256',"$registered/release-budgets.json"),@('beforePlanSha256',$plan),@('beforeSha256',$before),@('beforeNativeSha256',$beforeNative),@('settledSha256',$settled),@('settledNativeSha256',$settledNative))) { $registration[$entry[0]] = (Get-FileHash -LiteralPath $entry[1] -Algorithm SHA256).Hash.ToLowerInvariant() }
Assert-NewOutput "$registered/controller-registration.json"
$registration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$registered/controller-registration.json" -Encoding utf8NoBOM
```

ROOT reviews actual ceilings/nulls, failed-behavior provenance, exact hashes and registration time before controlled head timing. Head uses the generated release plan, frozen tools, admitted DE0 binary, same conditions/counts and new outputs/auth/control. No automatic source substitution, observer compatibility rule or head-result input to derivation is allowed.
