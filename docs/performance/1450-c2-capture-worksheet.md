# C2 controller worksheet — prepared, not executed

**Execution hold after the corrected native SDK SERVER observer:** the original binary is being rebuilt as exact 295 while policy version 3 remains bound to d555. The plan/build pins and hashes below describe the retained earlier preparation and must be refreshed only after [new actual observer proof and a prospective binding amendment](1450-observer-v4-proof-refresh.md). The old ac2 head observer artifact also needs replacement. Do not execute freeze/capture/derive blocks using these stale pins.

Preparation is against integration `b2c8f2591a60bfcf7135edc561ab7013f40487c2`. The mutable `before-plan-c2-DRAFT.json` now records that tooling commit. Its current byte hash is `22c1894d1ca43844f31f282c8c8b1d5a97b228c7ff5ed7b0592fc26ea3ab1847`. The adjacent `before-plan-c2-DRAFT-preparation-b2c8f2591.json` records exact primary, companion and budget source fingerprints and is explicitly **unfrozen**. No corrected full capture, freeze, actual budget derivation or controlled head timing was performed during preparation.

All non-runtime fields are deeply equal to original C1, whose unchanged byte hash is `3feed7ee263c08f522bc886c8390224abdbfa67926c4ff02d0fb50f3d30dabb3`. Original binary/observer source remains `d5550e35c3bd9adf584e9731ade31d6420abf545`; original business source remains `39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be`. There are 114 primary cohorts / 1380 visits: 540 first documents, 540 repeat Links, 135 return visits, 135 manual refreshes and 30 mutation refreshes. Each required first/Link cohort still has twenty samples, each declared functional cohort five. The separate companion has 54 cohorts / 1080 visits. Concurrency remains one. Notification permissions, sizes/roles, ranges, recipes, origin, pool/cache settings and fixture metadata are unchanged. This is holistic journey cost; ordinary caches can warm, `prepare(false)` can leave reads in flight, and Last Year → Custom includes prior annual work.

Use [the fixed release policy](1448-release-budgets.md) version 3 / companion version 3. Only the exact proved original annual verification timeout can qualify as failed-before observed traffic/paint, with every native, measured-document and finite resource check satisfied. Usable/clock failure p95 stays null with the existing absolute timeout fallback. Missing one of twenty native LCP entries/read markers leaves its budget null and comparison unfulfilled. Unknown rows, native coverage, wire bytes, caps, upstream/mandatory errors or failed prerequisites are not waived. Head must pass UI and resource gates. The old interrupted C1 ledger remains diagnostic only.

## Controller release and scheduling

Only the root controller starts these jobs, after the current functional/ingress windows have finished and it has resolved any sole-owner app finding. No heavy build/test or competing fixture activity should overlap controlled capture. Do not run these blocks during preparation. Retain the original app/DB/collector and private auth until **both original passes** complete; original mixed-load writes come afterward. Keep the pristine primary head fixture reserved for the later head pass. The controller owns any app/collector launch, shutdown or switch to the same `http://localhost:58792` origin.

The only prior full-pass evidence is interrupted C1: 1135 observations / 33 failures, with 4,298,112 ms (71.64 min) summed recorded visit intervals. Those are not wall time and have no valid native acceptance. A linear projection of that prefix is 87.10 min for 1380 primary intervals. The fixed two-second empty-context observation adds at least 46 min, giving roughly 133.1 min of scheduling arithmetic before authentication, prerequisites, collector drains, shutdown and the unobserved tail. The recorded first/Link subset is 895 visits / 3,715,943 ms; its linear projection to 1080 companion visits is 74.73 min, plus 36 min empty-context quiet and 18 min resource quiet, or roughly 128.7 min before the same omitted work. Reserve a multi-hour window for **each** original pass; there is no supported upper ETA. These arithmetic projections are not release percentiles, a timeout adjustment, or evidence that a future complete pass will succeed. Do not shrink the matrix or drop failed visits to meet a schedule.

## Paths and offline refresh

These paths were verified on disk. Auth/control contents remain private. No runtime endpoint was queried by this preparation.

```powershell
$ErrorActionPreference = 'Stop'
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$draft = Join-Path $scratch 'before-plan-c2-DRAFT.json'
$prep = Join-Path $scratch 'before-plan-c2-DRAFT-preparation-b2c8f2591.json'
$run = Join-Path $scratch 'before-c2'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$collector = Join-Path $scratch 'performance-runtime/observer-v3/collector-control.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
Set-Location -LiteralPath $source

# Optional OFFLINE refresh if the integrated tooling pin or any fingerprint changes.
# Use a NEW report filename; the helper changes only the mutable draft tooling pin.
# It requires a clean source checkout and exact original non-runtime workload.
# pnpm --config.verifyDepsBeforeRun=false node "$scratch/prepare-c2-draft.mjs" $source $scratch "$scratch/before-plan-c2-DRAFT-preparation-NEWPIN.json"
# Then update $prep to that new report and review before proceeding.

pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan $draft --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'Offline draft validation failed.' }
foreach ($path in @($auth, $collector, $chrome, $prep)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required file absent: $path" }
}
```

## Freeze — only after controller releases the window

The prepared scratch helper has not been run. It checks the draft/C1 hashes, deep non-runtime equality and current source hashes against the reviewed preparation. It refuses an existing run directory. It copies the exact measuring modules/proof files into a new frozen tooling snapshot and links the existing dependency directory; it performs no install, browser, app or database operation. It writes the frozen plan, source manifest and lockfile hash. Later capture/finalize/derive commands use that snapshot, so subsequent integration edits cannot silently change measuring source. Keep dependencies and Chrome stable across before/head; artifact comparison also enforces their actual recorded versions.

```powershell
pnpm --config.verifyDepsBeforeRun=false node "$scratch/freeze-c2-after-controller-release.mjs" --execute-freeze $source $scratch $prep $run
if ($LASTEXITCODE -ne 0) { throw 'Freeze did not complete. Preserve partial files and inspect; do not reuse the directory.' }
$plan = Join-Path $run 'before-plan-c2.json'
$tools = Join-Path $run 'tooling/scripts/performance'
$primary = Join-Path $run 'primary'
$before = Join-Path $primary 'baseline.json'
$beforeNative = Join-Path $run 'primary-native.json'
$settled = Join-Path $run 'settled.json'
$settledNative = Join-Path $run 'settled-native.json'

# Re-run OFFLINE admission from the copied tool source and its dependency junction.
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'Frozen source/plan admission failed.' }
$dependencyCheck = @'
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(pathToFileURL(process.argv[1]));
const loaded = await import(pathToFileURL(require.resolve("puppeteer-core")));
if (typeof (loaded.default?.launch ?? loaded.default?.default?.launch ?? loaded.launch) !== "function") throw Error("Puppeteer launch export missing");
console.log("Frozen Puppeteer resolution verified; no browser launched.");
'@
pnpm --config.verifyDepsBeforeRun=false node --input-type=module -e $dependencyCheck "$tools/run-baseline.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Frozen dependency resolution failed.' }

function Assert-NewOutput([string] $path) {
  if (Test-Path -LiteralPath $path) { throw "Output already exists: $path" }
}
function Export-CollectorMetrics([string] $controlPath, [string] $outputPath) {
  Assert-NewOutput $outputPath
  $control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
  if ($control.kind -ne 'z8-fixture-otlp-collector-v2') { throw 'Require the registered v2 collector.' }
  $metrics = [System.UriBuilder]::new([System.Uri]$control.endpoint)
  if ($metrics.Scheme -ne 'http' -or $metrics.Host -ne '127.0.0.1') { throw 'Require the owned loopback collector.' }
  $metrics.Path = '/metrics'
  $metrics.Query = ''
  $metrics.Fragment = ''
  Invoke-WebRequest -Uri $metrics.Uri -OutFile $outputPath | Out-Null
}
```

## Original primary capture and finalization

The existing original controller sessions were app `23041` / collector `30708`, origin 58792. The controller must confirm current ownership before executing; this worksheet does not infer liveness from saved files. The runner performs its normal exact build check and whole-run native reconciliation; no separate app warm-up is added.

```powershell
Assert-NewOutput $primary
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --auth $auth --chrome $chrome --collector $collector --out $primary *> "$run/primary-capture-private.log"
$primaryExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($primaryExit -ne 0 -or $raw.samples.Count -ne 1380 -or $raw.nativeRunCoverage.complete -ne $true) {
  throw 'Primary capture incomplete. Preserve all samples; do not finalize/derive a passing result.'
}
Assert-NewOutput "$primary/baseline.raw.json"
Copy-Item -LiteralPath $before -Destination "$primary/baseline.raw.json"
Export-CollectorMetrics $collector $beforeNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/run-baseline.mjs" --plan $plan --finalize $before --backend $beforeNative *> "$run/primary-finalize-private.log"
$primaryFinalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
if ($primaryFinalizeExit -ne 0 -or $final.acceptance -ne 'baseline-recorded' -or $final.evidenceComplete -ne $true -or $final.evidenceGates.Count -ne 0) {
  throw 'Original evidence/native gates remain unfulfilled; retain the raw ledger.'
}
```

`baseline-recorded` can retain known browser failures and primary CDP pending transfers; it does not mean successful behavior or complete full bytes. Preserve the original failure/censor flags. Do not use successful-only usable-content percentiles. A missing native LCP entry remains unknown even if native SQL coverage is complete.

## Original settled-resource companion and finalization

Run only after the primary capture has completely exited. The same immutable plan and original server remain in use. Capture exit 1 is expected because the new artifact awaits finalization; sample/native checks still must pass. Caps/errors remain in the ledger.

```powershell
Assert-NewOutput $settled
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" capture --plan $plan --auth $auth --chrome $chrome --collector $collector --out $settled *> "$run/settled-capture-private.log"
$settledCaptureExit = $LASTEXITCODE
$raw = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($settledCaptureExit -notin @(0, 1) -or $raw.samples.Count -ne 1080 -or $raw.nativeRunCoverage.complete -ne $true -or $raw.interrupted) {
  throw 'Companion capture incomplete; preserve the entire ledger.'
}
Assert-NewOutput "$run/settled.raw.json"
Copy-Item -LiteralPath $settled -Destination "$run/settled.raw.json"
Export-CollectorMetrics $collector $settledNative
pnpm --config.verifyDepsBeforeRun=false node "$tools/settled-resources.mjs" finalize --plan $plan --artifact $settled --backend $settledNative *> "$run/settled-finalize-private.log"
$settledFinalizeExit = $LASTEXITCODE
$final = Get-Content -Raw -LiteralPath $settled | ConvertFrom-Json
if ($settledFinalizeExit -ne 0 -or $final.evidenceComplete -ne $true -or $final.resourceComplete -ne $true) {
  throw 'Finite resources, native attribution or exact eligibility remain unfulfilled. No full-byte budget can be registered.'
}
```

Inspect `behaviorComplete`, `resourceObservationBasis` and retained failures; a complete failure drain can qualify only under the fixed original annual failure proof. Proxy compressed body bytes include all finite page/SW traffic with strict transport proof. CDP readiness/settling fields remain separately scoped observations; they are never relabeled full wire cost. Unknown inline decoded Flight, rows, registration/drain proof, post-initialization errors or incomplete cohorts reject registration.

## Derive and register before any controlled head observation

The existing candidate build record is `final-merged-head-build-v1/head-build.json`: successful CI/two workers, source `ac2fb11334b2fac88144dd405e39a15bd988d29c`. These inputs identify the candidate; they provide no head performance measurements. If the sole fix owner changes app source, the controller must use the new successfully verified build record and retain the old one. Do not change before identities or use candidate measurements to choose ceilings.

```powershell
$headBuildRecord = Get-Content -Raw -LiteralPath "$scratch/final-merged-head-build-v1/head-build.json" | ConvertFrom-Json
if ($headBuildRecord.kind -ne 'owned-final-head-build' -or $headBuildRecord.exitCode -ne 0 -or $headBuildRecord.ci -ne $true -or $headBuildRecord.workers -ne 2) {
  throw 'No admitted successful candidate build record.'
}
$releaseBuild = [string]$headBuildRecord.source
$releaseSource = [string]$headBuildRecord.source
$prepared = Get-Content -Raw -LiteralPath "$run/preparation.json" | ConvertFrom-Json
$registered = Join-Path $run 'registered-release'
Assert-NewOutput $registered
pnpm --config.verifyDepsBeforeRun=false node "$tools/release-budgets.mjs" derive --before-plan $plan --before $before --backend $beforeNative --before-settled $settled --before-settled-backend $settledNative --release-build $releaseBuild --release-source $releaseSource --release-tooling $prepared.toolingCommit --out $registered *> "$run/derive-private.log"
if ($LASTEXITCODE -ne 0) { throw 'Original evidence rejected; no release budget registered.' }
$registration = [ordered]@{
  kind = 'controller-release-budget-registration'
  registeredAt = [DateTimeOffset]::UtcNow.ToString('O')
  controlledHeadStarted = $false
  planSha256 = (Get-FileHash -LiteralPath "$registered/release-plan.json" -Algorithm SHA256).Hash.ToLowerInvariant()
  budgetsSha256 = (Get-FileHash -LiteralPath "$registered/release-budgets.json" -Algorithm SHA256).Hash.ToLowerInvariant()
  beforePlanSha256 = (Get-FileHash -LiteralPath $plan -Algorithm SHA256).Hash.ToLowerInvariant()
  beforeSha256 = (Get-FileHash -LiteralPath $before -Algorithm SHA256).Hash.ToLowerInvariant()
  beforeNativeSha256 = (Get-FileHash -LiteralPath $beforeNative -Algorithm SHA256).Hash.ToLowerInvariant()
  settledSha256 = (Get-FileHash -LiteralPath $settled -Algorithm SHA256).Hash.ToLowerInvariant()
  settledNativeSha256 = (Get-FileHash -LiteralPath $settledNative -Algorithm SHA256).Hash.ToLowerInvariant()
  frozenToolingCommit = $prepared.toolingCommit
  numericalPolicyVersion = 3
  policySource = 'ea5097ad21b2b0c03df437c449f11e6d31acf2ea'
}
Assert-NewOutput "$registered/controller-registration.json"
$registration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$registered/controller-registration.json" -Encoding utf8NoBOM
```

Review the generated per-cohort ceilings, nulls, failures/provenance, exact hashes and registration time. Unknown LCP remains an explicit unfulfilled comparison rather than an invented threshold; a successful `derive` operation alone is not release acceptance. No controlled head primary or companion starts before this registration/review. Prior functional candidate observations are already disclosed in policy and do not establish prospective phase budgets.

Later, after original mixed-load work and the controller's fixture/server switch, run head primary then head companion with the **exact generated** `release-plan.json`, same Chrome and frozen tooling, new head private auth/control, separate new output files and the same 1380/1080 counts. Flush/snapshot/finalize each through the same commands with head paths. Finish with:

```powershell
# Set these only after the controller's separate head launcher/admission and completed captures.
# $head, $headNative, $headSettled and $headSettledNative are NEW finalized evidence paths.
pnpm --config.verifyDepsBeforeRun=false node "$tools/release-budgets.mjs" compare --before-plan $plan --before $before --backend $beforeNative --before-settled $settled --before-settled-backend $settledNative --plan "$registered/release-plan.json" --budgets "$registered/release-budgets.json" --head $head --head-backend $headNative --head-settled $headSettled --head-settled-backend $headSettledNative --out "$registered/release-comparison.json"
```

Exit 1 retains unfulfilled numerical gates; exit 2 rejects inputs. Preserve all failures/pending scripts and primary CDP limitations even if a matched full wire gate fulfills resource acceptance. Whole-release acceptance still requires mixed load, functional/ingress/identity/totals and source-quality/formal-review evidence. No issue closure or PR-ready action is implied.
