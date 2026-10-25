# C3 controller worksheet — unfrozen preparation

The [two actual cleanup diagnostics](evidence/1450-primary-cleanup-functional.json) pass against unchanged original binary `295de0b706e439bcdaf4d2d25661ce45f02ddb61` / business source `39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be`. They retain partial primary byte flags and do not establish complete controlled evidence. Interrupted C1 and frozen C2 remain diagnostic only; C2 stopped at 49 visits / 11 native failures. No old ledger, frozen module or plan was changed or promoted.

The new `before-plan-c3-DRAFT.json` and `before-plan-c3-DRAFT-preparation-rootf47-cleanup.json` were prepared from **actual clean root `f47e7ff0ad3f737864368faa30e5444e19d8fc1e`**, with all three exact source fingerprint maps. The only runtime differences from frozen C2 are the new `nativeCleanupPolicy: "post-snapshot-finite-prefetch-quiet-v1"` and tooling pin. All non-runtime C1 fields remain deeply equal, with original C1 SHA-256 `3feed7ee263c08f522bc886c8390224abdbfa67926c4ff02d0fb50f3d30dabb3`, concurrency one, 114 primary cohorts / 1380 visits (540 first documents, 540 repeat Links, 135 returns, 135 manual refreshes, 30 mutation refreshes) and 54 companion cohorts / 1080 visits. Every required first/Link cohort retains twenty fresh contexts; declared functional cohorts retain five visits.

Numerical policy 4 / companion 4, exact original failure eligibility, all factors/floors, timeout, identity, ranges and recipes remain unchanged. The supplementary cleanup proof is functional provenance, not a new threshold input or eligibility waiver; it does not need to join the fixed original cause-proof binding. Primary/companion/budget source maps already include the new cleanup helper. Companion capture already copies the complete plan runtime into its metadata and uses the exact plan hash, so the same cleanup condition is recorded without changing its timing or settling code.

| Reviewed input                  | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| C3 mutable draft                | `c14f8002e894b00edef2437a33d92fd33bcd38e7fb34363519d0d5e0b3c4ef78` |
| C3 preparation sidecar          | `8e3fb5638e76aa79194aa2cf6aa60789a4f97084c7155806fd742ddf8ebebe52` |
| C3 preparation helper           | `18bca1d2a47d5aacff6e66612db62bacadc6eea35ba7ebccb80461476170e29a` |
| C3 freeze helper, unexecuted    | `b58943c16a0fc0c8598bab561551ca58e111cb2216dc8596b1a1a210bb09f9de` |
| File-based controller admission | `9a18f30f30f156c2b8930a96301fa1e66e55ac4747eadb7709ea51e84579b8c1` |
| Admitted 31d head build record  | `5056162573403c3b206f0b76d79c83d0e3d62f7a683d39e324d31ad87aabcccf` |

The new C3 helpers are narrow copies of the C2 preparation/freeze operators with C3 draft/plan filenames; original C2 helper behavior is retained. The freeze helper remains unexecuted and `before-c3` does not exist. After a doc-only merge the source pin may remain an ancestor if every measuring source byte still matches. On any measuring-source drift, run `prepare-c3-draft.mjs` from the new clean root into a **new** sidecar, then review and update `$prep`. Never alter frozen C2 files.

Only the root controller runs the following blocks, after its final epoch release and quiet-window review. No heavy build/test or competing fixture IO may overlap controlled capture. Original app/controller sessions were `4343` / collector `4775`, but saved artifacts do not prove current liveness. Use the owned v5 controls, same original origin and private auth, and keep the pristine head fixture reserved. Original mixed-load writes must wait until both original passes complete.

Reserve multi-hour windows for each pass. Interrupted C1 recorded 1135 visits / 71.64 minutes of summed terminal intervals, not wall time; prefix projections omit prerequisites, auth, quiet periods, native drains and shutdown. The new primary cleanup includes at least 1380 seconds of quiet across 1380 visits, outside the measured intervals, and may cap/fail. Neither two diagnostic timings nor interrupted C1 provides a reliable upper ETA or release percentile.

```powershell
$ErrorActionPreference = 'Stop'
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$prep = Join-Path $scratch 'before-plan-c3-DRAFT-preparation-rootf47-cleanup.json'
$run = Join-Path $scratch 'before-c3'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$collector = Join-Path $scratch 'performance-runtime/observer-v5/collector-control.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
Set-Location -LiteralPath $source
# OFFLINE refresh only if source maps drift; choose a NEW report filename and review it.
# pnpm --config.verifyDepsBeforeRun=false node "$scratch/prepare-c3-draft.mjs" $source $scratch "$scratch/before-plan-c3-DRAFT-preparation-NEWPIN.json" before-plan-c3-DRAFT.json
pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan "$scratch/before-plan-c3-DRAFT.json" --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'C3 draft admission failed.' }
```

## Root-only freeze and admission

Freeze refuses an existing run directory, verifies exact plan/source hashes and C1 non-runtime equality, copies all executed modules/proofs, and links the existing dependencies. It performs no install or capture. The later **file-based** admission checks Puppeteer resolution and native counters; the controller must run it only when runtime checks are released. Windows' pnpm version-switch wrapper rejects multiline `node -e` arguments, so no such invocation is used here.

```powershell
pnpm --config.verifyDepsBeforeRun=false node "$scratch/freeze-c3-after-controller-release.mjs" --execute-freeze $source $scratch $prep $run
if ($LASTEXITCODE -ne 0) { throw 'Freeze failed; retain partial files and choose a new run directory.' }
$plan = Join-Path $run 'before-plan-c3.json'
$tools = Join-Path $run 'tooling/scripts/performance'
$primary = Join-Path $run 'primary'
$before = Join-Path $primary 'baseline.json'
$beforeNative = Join-Path $run 'primary-native.json'
$settled = Join-Path $run 'settled.json'
$settledNative = Join-Path $run 'settled-native.json'
Copy-Item -LiteralPath "$scratch/controller-admission-c3.mjs" -Destination "$run/controller-admission.mjs"
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

Preserve `behaviorComplete`, failure stages/causes, null UI percentiles, raw native close proofs and elapsed times, cleanup caps/errors, and separate CDP/wire scopes. All twenty real native LCP entries/read markers are required per first-document cohort; an unknown value stays unfulfilled. The full-byte gate uses only matched complete companion proxy body units and native/transport proof. The workload remains holistic journey cost, including Last Year → Custom and potentially inflight `prepare(false)` reads, with ordinary runtime cache warming.

## Derive and register before any controlled head timing

```powershell
$headBuildRecord = Get-Content -Raw -LiteralPath "$scratch/final-header-hydration-build-v1/head-build.json" | ConvertFrom-Json
if ($headBuildRecord.kind -ne 'owned-final-head-build' -or $headBuildRecord.source -ne '31d67bbcb95ec8cf6d25d363c04c9f9a47570f0a' -or $headBuildRecord.ci -ne $true -or $headBuildRecord.workers -ne 2 -or $headBuildRecord.exitCode -ne 0) { throw 'Admitted 31d build record changed.' }
$prepared = Get-Content -Raw -LiteralPath "$run/preparation.json" | ConvertFrom-Json
$registered = Join-Path $run 'registered-release'
Assert-NewOutput $registered
pnpm --config.verifyDepsBeforeRun=false node "$tools/release-budgets.mjs" derive --before-plan $plan --before $before --backend $beforeNative --before-settled $settled --before-settled-backend $settledNative --release-build $headBuildRecord.source --release-source $headBuildRecord.source --release-tooling $prepared.toolingCommit --out $registered *> "$run/derive-private.log"
if ($LASTEXITCODE -ne 0) { throw 'Original evidence rejected; no budgets registered.' }
$registration = [ordered]@{ kind = 'controller-release-budget-registration'; registeredAt = [DateTimeOffset]::UtcNow.ToString('O'); controlledHeadStarted = $false; numericalPolicyVersion = 4; frozenToolingCommit = $prepared.toolingCommit; policyProofSource = '5031575cc8c40db7d5e306ecb54c641c150c3846' }
foreach ($entry in @(@('planSha256',"$registered/release-plan.json"),@('budgetsSha256',"$registered/release-budgets.json"),@('beforePlanSha256',$plan),@('beforeSha256',$before),@('beforeNativeSha256',$beforeNative),@('settledSha256',$settled),@('settledNativeSha256',$settledNative))) { $registration[$entry[0]] = (Get-FileHash -LiteralPath $entry[1] -Algorithm SHA256).Hash.ToLowerInvariant() }
Assert-NewOutput "$registered/controller-registration.json"
$registration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$registered/controller-registration.json" -Encoding utf8NoBOM
```

Review all ceilings, nulls, failure/resource provenance, exact hashes and registration time before controlled head collection. After the controller's separate fixture switch, head primary/companion must use the exact generated release plan, frozen source, same dependencies/Chrome and counts, new auth/control and new outputs. Every head UI/native/resource gate must pass. Compare through `release-budgets.mjs compare` with all original/head primary and companion inputs; numerical comparison alone never completes mixed-load, identity, ingress, totals, quality or formal-review gates.
