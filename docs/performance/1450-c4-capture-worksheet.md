# C4 controller worksheet — unfrozen preparation

**C4 subsequently froze and was interrupted at 65 samples / five mutation-refresh failures, with all five restored.** Keep its frozen modules, plan, raw ledger and interruption immutable; do not execute this historical worksheet or derive from C4. The [C5 mutation/reset reload correction](1450-c5-operator-reloads.md) requires actual bounded mutation proof before another full freeze. Statements below describe the earlier C4 preparation review.

The [numeric functional proof](evidence/1450-c4-prerequisite-functional.json) verifies 25 normal primary and six normal companion visits with zero UI failures and exact whole-run native totals 40675 / 11077. One representative large-admin analytics/year Link retains its known `verify-expected-content` timeout, null usable-content latency and existing before-failure policy match; its prerequisite/cleanup/transport/native observation is complete with 13690 exact queries. These are bounded diagnostics, not complete controlled cohorts. Initial zero-sample launch cause remains UNKNOWN; the first escalated visit was valid and rejected by a wrapper row-count bug. The corrected guard requires three exact complete native identities, every received row valid, and allows an absent OTLP row only for independently proved zero work; fourteen negative cases reject. All raw attempts remain preserved.

C1/C2/C3 frozen evidence remains immutable and diagnostic only; C2 stopped at 49 visits / 11 failures and C3 at 94 / 48 with all five completed mutations restored. C4 explicitly changes the warm preparation condition: prerequisite transfers settle before leaving target/away or starting refresh. It is **not identical execution to C1/C2/C3**, although every non-runtime plan field/recipe/count remains equal to C1. Both original and head must use `prerequisiteQuiescencePolicy: "settled-prerequisite-transfers-v1"`. Numerical/companion policy 5 changes condition metadata only: all numerical factors/floors, original binary295/business39 and exact failure/paint proof binding remain unchanged. Prerequisite quiet is one second with the existing 30-second plan timeout as a setup cap; post-snapshot cleanup and post-ready companion caps remain ten seconds. Optional prefetch errors stay separately recorded; mandatory errors/caps/unknowns and any native inconsistency remain failed.

`before-plan-c4-DRAFT.json` and its NEW `before-plan-c4-DRAFT-preparation-root996303-settled.json` were prepared from actual clean root `996303e9beea1f3527ca55684d82a2b715ea8512`, with all three source fingerprint maps. All non-runtime C1 fields deeply match original SHA-256 `3feed7ee263c08f522bc886c8390224abdbfa67926c4ff02d0fb50f3d30dabb3`: 114 primary cohorts / 1380 visits (540 first documents, 540 repeat Links, 135 returns, 135 manual refreshes, 30 mutations), 54 companion cohorts / 1080 visits, concurrency one. Required first/Link cohorts retain twenty fresh contexts and functional cohorts five visits. Runtime-only cleanup/preparation/tooling changes are disclosed; no app or native-accounting change was made.

| Reviewed input                 | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| C4 mutable draft               | `fb1147490c118a6a99ebabd39e2c6c3209dfad666ed2d3c6a4efbeb7d972d7e7` |
| C4 preparation sidecar         | `4bc96e16fd4aca677d97d67c3e4c75a3d7d4a1db682e7b3b5d4a3d3e5d675734` |
| C4 preparation helper          | `b242b0904adeaf0382c8f35ba94e607c5c9d8bceb11e5e6f72a86277fe9f6983` |
| C4 freeze helper, unexecuted   | `4b7bc343e8bb2e99eea6a5da22192af8fbf74a440bd133b8e4afb47999a77d7d` |
| File-based admission           | `9a18f30f30f156c2b8930a96301fa1e66e55ac4747eadb7709ea51e84579b8c1` |
| Admitted 31d head build record | `5056162573403c3b206f0b76d79c83d0e3d62f7a683d39e324d31ad87aabcccf` |

New C4-only helper copies target only the mutable C4 draft and NEW `before-c4` output. Original helpers and all frozen directories are retained. The freeze helper is unexecuted and `before-c4` does not exist. A doc-only merge can leave the prepared tooling pin as an ancestor if every measuring byte still matches; on drift, run the C4 preparation helper from the clean actual root into a NEW sidecar and review it. No budget derivation, registration or controlled head timing has occurred.

Only the root controller runs these blocks after releasing a quiet exclusive window. Original v6 app/collector sessions were 34955 / 45906, unchanged295 at58792; confirm current ownership/liveness rather than infer it from files. No heavy tests/builds or competing fixture IO during capture. Keep pristine31d head reserved. Original mixed writes follow BOTH complete original captures. Ingress correction/actual validation, mixed load, final review and other release gates remain pending; these diagnostics do not establish final release readiness.

Reserve multi-hour windows per pass; historical C1 intervals are not wall time or a reliable upper ETA. C4 adds setup quiet per warm phase outside measured timings, and future caps/errors remain failures. Do not reduce counts or tune thresholds for schedule.

```powershell
$ErrorActionPreference = 'Stop'
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$prep = Join-Path $scratch 'before-plan-c4-DRAFT-preparation-root996303-settled.json'
$run = Join-Path $scratch 'before-c4'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$collector = Join-Path $scratch 'performance-runtime/observer-v6/collector-control.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
Set-Location -LiteralPath $source
# OFFLINE refresh only on measuring-byte drift; choose a NEW sidecar filename and review.
# pnpm --config.verifyDepsBeforeRun=false node "$scratch/prepare-c4-draft.mjs" $source $scratch "$scratch/before-plan-c4-DRAFT-preparation-NEWPIN.json" before-plan-c4-DRAFT.json
pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan "$scratch/before-plan-c4-DRAFT.json" --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'C4 draft admission failed.' }
```

## Root-only freeze and admission

Freeze refuses an existing run directory, verifies exact plan/source hashes and C1 non-runtime equality, copies all executed modules/proofs, and links the existing dependencies. It performs no install or capture. The later **file-based** admission checks Puppeteer resolution and native counters; the controller must run it only when runtime checks are released. Windows' pnpm version-switch wrapper rejects multiline `node -e` arguments, so no such invocation is used here.

```powershell
pnpm --config.verifyDepsBeforeRun=false node "$scratch/freeze-c4-after-controller-release.mjs" --execute-freeze $source $scratch $prep $run
if ($LASTEXITCODE -ne 0) { throw 'Freeze failed; retain partial files and choose a new run directory.' }
$plan = Join-Path $run 'before-plan-c4.json'
$tools = Join-Path $run 'tooling/scripts/performance'
$primary = Join-Path $run 'primary'
$before = Join-Path $primary 'baseline.json'
$beforeNative = Join-Path $run 'primary-native.json'
$settled = Join-Path $run 'settled.json'
$settledNative = Join-Path $run 'settled-native.json'
Copy-Item -LiteralPath "$scratch/controller-admission-c4.mjs" -Destination "$run/controller-admission.mjs"
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'Frozen source/plan admission failed.' }
pnpm --config.verifyDepsBeforeRun=false node "$run/controller-admission.mjs" "$tools/run-baseline.mjs" "$tools/collector-client.mjs" $collector
if ($LASTEXITCODE -ne 0) { throw 'Frozen dependencies or fresh native epoch are not ready.' }
function Assert-NewOutput([string] $path) { if (Test-Path -LiteralPath $path) { throw "Output exists: $path" } }
function Export-CollectorMetrics([string] $controlPath, [string] $outputPath) {
  Assert-NewOutput $outputPath
  $control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
  $uri = [System.UriBuilder]::new([System.Uri]$control.endpoint)
  if ($control.kind -ne 'z8-fixture-otlp-collector-v2' -or $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1') { throw 'Require the owned registered v2 collector.' }
  $uri.Path = '/metrics'; $uri.Query = ''; $uri.Fragment = ''
  Invoke-WebRequest -Uri $uri.Uri -OutFile $outputPath | Out-Null
}
```

## Original primary and companion

Both capture operators intentionally exit 1 after saving an unfinalized ledger. Finalization must exit 0 with complete evidence. A known failed original annual UI cohort can remain failed/censored only under the fixed before-only cause/native/resource policy. Complete cleanup must never relabel original primary CDP bytes or pending flags as complete full cost.

```powershell
Assert-NewOutput $primary
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --auth $auth --chrome $chrome --collector $collector --out $primary *> "$run/primary-capture-private.log"
$captureExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($captureExit -ne 1 -or $raw.samples.Count -ne 1380 -or $raw.nativeRunCoverage.complete -ne $true) { throw 'Primary incomplete; retain every failure and do not derive.' }
Assert-NewOutput "$primary/baseline.raw.json"
Copy-Item -LiteralPath $before -Destination "$primary/baseline.raw.json"
Export-CollectorMetrics $collector $beforeNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --finalize $before --backend $beforeNative *> "$run/primary-finalize-private.log"
$finalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($finalizeExit -ne 0 -or $final.acceptance -ne 'baseline-recorded' -or $final.evidenceComplete -ne $true -or $final.evidenceGates.Count -ne 0) { throw 'Primary evidence/native/cleanup gates remain unfulfilled.' }

# Start the separate resource pass only after primary capture/finalization fully exit.
Assert-NewOutput $settled
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" capture --plan $plan --auth $auth --chrome $chrome --collector $collector --out $settled *> "$run/settled-capture-private.log"
$captureExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($captureExit -ne 1 -or $raw.samples.Count -ne 1080 -or $raw.nativeRunCoverage.complete -ne $true -or $raw.interrupted) { throw 'Companion incomplete; retain all samples.' }
Assert-NewOutput "$run/settled.raw.json"
Copy-Item -LiteralPath $settled -Destination "$run/settled.raw.json"
Export-CollectorMetrics $collector $settledNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" finalize --plan $plan --artifact $settled --backend $settledNative *> "$run/settled-finalize-private.log"
$finalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($finalizeExit -ne 0 -or $final.evidenceComplete -ne $true -or $final.resourceComplete -ne $true) { throw 'Companion resources/native/eligibility remain unfulfilled.' }
```

Preserve `behaviorComplete`, failure stages/causes, null UI percentiles, raw native close proofs and elapsed times, cleanup caps/errors, and separate CDP/wire scopes. All twenty real native LCP entries/read markers are required per first-document cohort; an unknown value stays unfulfilled. The full-byte gate uses only matched complete companion proxy body units and native/transport proof. Last Year → Custom and `prepare(false)` recipe steps are retained; C4 settles unmeasured warm transfers before the target transition. Measured holistic journey cost includes the actual target-range work, with ordinary runtime cache warming.

## Derive and register before any controlled head timing

```powershell
$headBuildRecord = Get-Content -Raw -LiteralPath "$scratch/final-header-hydration-build-v1/head-build.json" | ConvertFrom-Json
if ($headBuildRecord.kind -ne 'owned-final-head-build' -or $headBuildRecord.source -ne '31d67bbcb95ec8cf6d25d363c04c9f9a47570f0a' -or $headBuildRecord.ci -ne $true -or $headBuildRecord.workers -ne 2 -or $headBuildRecord.exitCode -ne 0) { throw 'Admitted 31d build record changed.' }
$prepared = Get-Content -Raw -LiteralPath "$run/preparation.json" | ConvertFrom-Json
$registered = Join-Path $run 'registered-release'
Assert-NewOutput $registered
pnpm --config.verifyDepsBeforeRun=false node "$tools/release-budgets.mjs" derive --before-plan $plan --before $before --backend $beforeNative --before-settled $settled --before-settled-backend $settledNative --release-build $headBuildRecord.source --release-source $headBuildRecord.source --release-tooling $prepared.toolingCommit --out $registered *> "$run/derive-private.log"
if ($LASTEXITCODE -ne 0) { throw 'Original evidence rejected; no budgets registered.' }
$registration = [ordered]@{ kind = 'controller-release-budget-registration'; registeredAt = [DateTimeOffset]::UtcNow.ToString('O'); controlledHeadStarted = $false; numericalPolicyVersion = 5; frozenToolingCommit = $prepared.toolingCommit; policyProofSource = '5031575cc8c40db7d5e306ecb54c641c150c3846' }
foreach ($entry in @(@('planSha256',"$registered/release-plan.json"),@('budgetsSha256',"$registered/release-budgets.json"),@('beforePlanSha256',$plan),@('beforeSha256',$before),@('beforeNativeSha256',$beforeNative),@('settledSha256',$settled),@('settledNativeSha256',$settledNative))) { $registration[$entry[0]] = (Get-FileHash -LiteralPath $entry[1] -Algorithm SHA256).Hash.ToLowerInvariant() }
Assert-NewOutput "$registered/controller-registration.json"
$registration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$registered/controller-registration.json" -Encoding utf8NoBOM
```

Review all ceilings, nulls, failure/resource provenance, exact hashes and registration time before controlled head collection. After the controller's separate fixture switch, head primary/companion must use the exact generated release plan, frozen source, same dependencies/Chrome and counts, new auth/control and new outputs. Every head UI/native/resource gate must pass. Compare through `release-budgets.mjs compare` with all original/head primary and companion inputs; numerical comparison alone never completes mixed-load, identity, ingress, totals, quality or formal-review gates.
