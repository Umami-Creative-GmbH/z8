# Primary native cleanup correction — finite proof pending

The immutable C2 ledger stopped after 49 visits / 11 native-coverage failures. Its first failed small-admin dashboard visit retained nine pending CDP requests, an incomplete resource window, usable content 649.889 ms / native LCP 516 ms / clock 559.088 ms, and a native close cap of 10013.448 ms. All three native close proofs were incomplete despite balanced queries, acquisitions and cache counts and complete driver accounting. Earlier successful closures also retained pending CDP requests; this evidence supports testing a closure gap but does not establish the exact unfinished SERVER cause. C2 remains interrupted diagnostic evidence; never finalize or derive from it.

The primary now fixes all existing readiness, native paint, CDP byte and pending-resource snapshots at their original points, detaches CDP and performs any existing mutation restoration, then observes already running HTTP through the context proxy before closing the context or the native registration. The separate `sample.nativeCleanup` record requires one second of quiet and zero pending mandatory finite requests **and explicit-header prefetches**, capped at ten seconds. Errors do not cause early closure while another finite response is pending. Mandatory errors, unknown metrics, observation overflow and caps fail cleanup. Explicit prefetch errors stay separately counted under the existing policy; native and strict transport proofs still have to pass. The drain makes no browser requests, reloads or data reads. It does not update primary byte totals, pending flags, readiness values or successful-route claims.

The new runtime condition is `nativeCleanupPolicy: "post-snapshot-finite-prefetch-quiet-v1"`. Primary finalization and numerical registration require the matching recorded condition and complete cleanup proof. The helper joins all transitive source fingerprint maps. Original binary 295/business39, native accounting, numerical policy 4, failure eligibility and all fixed factors remain unchanged. The settled companion already has a separate wire settling pass and has not been changed by this correction; any residual companion closure gap still requires actual evidence.

The focused regression uses an actual loopback HTTP response and a real `BasicTracerProvider` SERVER span: immediate closure is red while the response remains pending; the drain turns green after response completion and native span end, with original sample snapshots unchanged. Separate HTTP tests retain mandatory errors, keep explicit prefetch errors separate and cap an unfinished prefetch. Unknown wire fields cannot become a known-zero observation. These tests do not prove the original fixture's actual native result; the controller must perform the bounded diagnostic below first.

## Controller-only finite diagnostic

These commands are prepared, not executed by the preparation agent. The controller must confirm its fresh v5 collector/native epoch and unchanged original 295 app are ready. Both runs use one existing journey via the normal `--verify-journeys` operator. They are diagnostics, not twenty-sample evidence or a frozen C3 pass. Use new outputs and preserve every failure.

```powershell
$ErrorActionPreference = 'Stop'
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
Set-Location -LiteralPath $source
$diagnosticPlan = Join-Path $scratch 'before-c3-native-cleanup-DIAGNOSTIC.json'
if (Test-Path -LiteralPath $diagnosticPlan) { throw 'Choose a new diagnostic plan filename.' }
$plan = Get-Content -Raw -LiteralPath "$scratch/before-c2/before-plan-c2.json" | ConvertFrom-Json
$plan.runtime | Add-Member -NotePropertyName nativeCleanupPolicy -NotePropertyValue 'post-snapshot-finite-prefetch-quiet-v1' -Force
$plan.runtime.toolingBuild = (git rev-parse HEAD).Trim()
$plan | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $diagnosticPlan -Encoding utf8NoBOM
pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan $diagnosticPlan --validate-plan
if ($LASTEXITCODE -ne 0) { throw 'Offline diagnostic admission failed.' }
$collector = Join-Path $scratch 'performance-runtime/observer-v5/collector-control.json'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
foreach ($mode in @('first-document', 'repeat-link')) {
  $out = Join-Path $scratch "observer-v5-primary-cleanup-$mode-diagnostic"
  if (Test-Path -LiteralPath $out) { throw 'Diagnostic output already exists; choose a new name.' }
  pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan $diagnosticPlan --auth $auth --chrome $chrome --collector $collector --verify-journeys --condition small-admin --route dashboard --mode $mode --out $out *> "$out-private.log"
  $captureExit = $LASTEXITCODE
  $raw = Get-Content -Raw -LiteralPath "$out/baseline.json" | ConvertFrom-Json
  if ($captureExit -ne 1 -or $raw.kind -ne 'journey-verification' -or $raw.samples.Count -ne 1 -or $raw.nativeRunCoverage.complete -ne $true) { throw 'Finite diagnostic incomplete; retain evidence and diagnose.' }
  $sample = $raw.samples[0]
  if ($sample.failed -or $sample.nativeCleanup.complete -ne $true -or $sample.collector.coverage.nativeProof -ne $true) { throw 'Cleanup/native proof still failed; retain raw evidence.' }
}
```

Review the separate cleanup snapshot, all three raw native close proofs and close elapsed time, global driver/start/end/export reconciliation, transport totals, and the **unchanged partial primary resource flags**. A complete cleanup snapshot cannot relabel primary CDP bytes as full cost. No blanket downstream cancellation waiver applies. If native closure still caps despite finite completion, retain that result and investigate the remaining lifecycle cause.

Only after finite actual proof may the controller prepare a new C3 plan/sidecar with the runtime condition and new tooling hashes. Keep every non-runtime field equal to original C1: 114 primary cohorts / 1380 visits and 54 companion cohorts / 1080 visits, with twenty first documents and twenty repeat Links per required cohort and five functional visits. The C2 source, plan, preparation reports, raw ledgers and interruption remain immutable. No C3 freeze, budget derivation or head capture is authorized by this diagnostic worksheet.
