# Corrected original observer: proof refresh before C2

**Current status:** root completed the two admitted 295 diagnostics. The new [numeric-only proof](evidence/1450-observer-v4-before-proof.json) is committed at `5031575cc8c40db7d5e306ecb54c641c150c3846`; the active prospective policy is now numerical 4 / companion 4 / before-failure 2, amended at `2026-10-24T22:51:03Z`, with unchanged factors and exact 295/business39 eligibility. Fresh bounded logs confirm pool-acquisition timeout (one primary / three finite DatabaseError causes), native query errors zero, complete strict native/transport/wire drain, and only **one** raw native paint observation. Old d555 proofs remain unchanged. Root review, full C2 freeze/captures and actual derivation are still pending. The remaining text retains the initial diagnostic procedure/history; its commands should not be rerun over the existing outputs.

**Preparation only.** Integration `c632301be625efc44326f945fdcfdd9f49463619` includes isolated observer correction `e059597490b02c575c6e1cf64f1d83da712cff97`. The original observer-only checkout is now `295de0b706e439bcdaf4d2d25661ce45f02ddb61`, with original business source still `39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be`. Its exact difference from `d5550e35c3bd9adf584e9731ade31d6420abf545` is native coverage implementation plus its new test. The old binary and all `d555` evidence remain preserved.

The fix uses native SDK `SpanKind.SERVER === 1` in lifecycle accounting; the serialized OTLP SERVER value remains **2**, correctly unchanged in the collector. Existing native protocol names remain v2. The local `observer-v4` directory names identify a new build/collector generation, not a new wire protocol. The SDK-enum lifecycle/delayed-child regression uses actual SDK SpanKind constants with structural native-span fixtures; it demonstrates that a server left open beyond the previous 500 ms quiet window retains a child query arriving after 650 ms. It is not an SDK-provider-created HTTP integration test. Unit evidence does not replace actual new-binary native/wire proof.

Active numerical policy version 3 / companion version 3 is still exactly bound to **d555** for failed-before eligibility. It must not be widened to accept 295, arbitrary observer descendants, either binary via an OR, unknown errors or incomplete coverage. No policy, proof hash, factor, floor, timeout or full C2 plan has been changed by this preparation. No browser/runtime request, freeze, capture or derivation has run here.

## Root's next finite diagnostics

Run only after the root-owned original CI build completes successfully and root admits/restarts the new original app with its new `performance-runtime/observer-v4/collector-control.json`. Preserve the old `.next-observer-v3-d555`, v3 collector files and prior raw failures. Root owns start/stop and exclusive fixture windows. Do not infer liveness or CI success from a source commit; the build record was still pending when this worksheet was prepared.

Two diagnostic inputs are already prepared in the shared scratch directory, neither executed:

- `annual-original-c2-observer-v4-DIAGNOSTIC.json`: copied from the unfrozen full draft, changes only runtime binary/observer source to exact 295 and tooling to c632, plus restricts the diagnostic analytics route to year and first/Link modes. Fixture, actors, dates, expected 200 rows / 2088.0h, timeout, pool/cache, recipe and sample declarations are unchanged. The full C2 draft remains untouched/d555-bound.
- `telemetry-observer-v4-finite-1plus1-diagnostic.mjs`: a new copy of the existing `telemetry-link-reason-diagnostic.mjs`, pointed at the integrated helpers/new control/diagnostic plan and expanded only to one first-document plus one repeat-Link. It uses `measureFixtureResources` and `runCompanionCapture`, records `settled-resource-diagnostic` / `unfulfilled`, and never invokes normal finalization or registration. It adds no fetch/body instrumentation and performs no mutation. Original scratch diagnostics remain unchanged.

The separate primary visit recovers actual native LCP/Event Timing observations through the installed runner and remains `journey-verification`. The finite companion visits prove actual finite wire/native draining through the same shared path. Neither diagnostic reduces the required full 20/20 cohorts.

```powershell
$ErrorActionPreference = 'Stop'
$source = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$diagnosticPlan = Join-Path $scratch 'annual-original-c2-observer-v4-DIAGNOSTIC.json'
$auth = Join-Path $scratch 'performance-runtime/auth-private.json'
$collector = Join-Path $scratch 'performance-runtime/observer-v4/collector-control.json'
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$primaryDiagnostic = Join-Path $scratch 'observer-v4-annual-c2-native-paint-diagnostic'
Set-Location -LiteralPath $source

# Admission only after ROOT reports the new build successful and new app ready.
$built = Get-Content -Raw -LiteralPath "$scratch/original-observer-v4-build/before-build.json" | ConvertFrom-Json
if ($built.kind -ne 'owned-original-observer-build' -or $built.source -ne '295de0b706e439bcdaf4d2d25661ce45f02ddb61' -or $built.businessSource -ne '39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be' -or $built.exitCode -ne 0 -or -not $built.finishedAt -or $built.ci -ne $true -or $built.workers -ne 2) {
  throw 'Corrected original build is not admitted.'
}
if (-not (Test-Path -LiteralPath $collector)) { throw 'New root-owned v4 control not ready.' }
if (Test-Path -LiteralPath $primaryDiagnostic) { throw 'Diagnostic output already exists; preserve it and choose a new attempt path.' }
pnpm --config.verifyDepsBeforeRun=false node scripts/performance/run-baseline.mjs --plan $diagnosticPlan --verify-journeys --condition large-admin --route analytics --mode first-document --auth $auth --chrome $chrome --collector $collector --out $primaryDiagnostic *> "$scratch/observer-v4-annual-c2-native-paint-private.log"
$primaryDiagnosticExit = $LASTEXITCODE
# Retain this code and every sample even when UI verification fails. Do not finalize as a benchmark.

# Run serially after the first process has completely exited.
if (Test-Path -LiteralPath "$scratch/observer-v4-annual-c2-finite-1plus1-diagnostic") {
  throw 'Finite output already exists; preserve it and prepare a new explicitly named attempt.'
}
pnpm --config.verifyDepsBeforeRun=false node "$scratch/telemetry-observer-v4-finite-1plus1-diagnostic.mjs" *> "$scratch/observer-v4-annual-c2-finite-1plus1-private.log"
$finiteDiagnosticExit = $LASTEXITCODE
```

The primary runner snapshots collector metrics during whole-run reconciliation. For an immutable new copy, root can use the `Export-CollectorMetrics` function from the [capture worksheet](1450-c2-capture-worksheet.md) with the **v4** control and a new diagnostic-native path. The finite existing operator already saves its selected measured/prerequisite/background `backend-metrics.json`. Keep whole-run accounting, all returned traces and original errors rather than publishing a successful subset. If either run has incomplete closure/native evidence, stop expansion and resolve it; do not run the next probe over leaked active contexts.

Collect the fresh underlying annual cause from the **new launch / current diagnostic** log interval using the existing bounded numeric classification method. Do not copy d555's 69/93/94 failed-acquisition counts or its nine-of-ten log matches. Require actual pool-acquisition timeout classification, fixed 10-second/max-ten configuration, zero statement/query/schema errors and exact query/acquisition-error arithmetic. A zero-row DOM or HTTP 200 alone is not proof of an empty successful response or of the pool cause. If the new failure cause is unknown, retain it as unknown and do not activate the exception. If UI now succeeds, record success; do not manufacture a failed outcome to match the old proof.

## Minimum new public proof, after actual observations exist

Write a **new** minimal numeric file, for example `docs/performance/evidence/1450-observer-v4-before-proof.json`. Do not replace or edit `1450-telemetry-functional-diagnostics.json` or `1450-native-paint-and-link-diagnostics.json`. Record:

- Full exact new binary/observer source 295, original business source 39, isolated observer correction commit and actual successful build admission. Link the old d555 cause/paint proof hashes as historical provenance, not new actual proof.
- Actual diagnostic source/helper fingerprint maps and plan hash, browser version, visit modes, stage/kind, measured/prerequisite/target-prepared flags and retained failed/censored/usable timing fields.
- Fresh bounded cause classifications and query/acquisition/acquisition-error numbers for each phase, zero known statement/query/schema error counts; unknown fields stay null and block eligibility.
- New whole-run driver = native-start = native-end = collector counts, no pending/active/late/unattributed work, closed per-trace proof and strict transport initialization/arithmetic/no-post-init-error evidence. Corrected SDK SERVER accounting is now part of the pinned binary; old d555 counts do not prove that lifecycle guard.
- Complete finite failure drain (or successful settled window) for each actual visit, known byte/group/per-trace reconciliation and inline bytes, no mandatory errors/pending/cap/overflow/redirect ambiguity. Preserve any failure instead of summing only successful responses.
- The new **one** first-document raw native LCP/read/entry observation if available, with actual Event Timing count/maximum separately. Missing paint remains null. One observation is diagnostic proof only and never twenty-sample completeness or an actual release budget.

Only after root reviews that actual proof should the owner make the narrow prospective amendment. The intended change is a **new active proof/binding**, not a generic compatibility rule: exact new binary 295 + exact business 39, same annual analytics/admin200/range2025/pool10/30-second verification-timeout scope and all existing prerequisites/error/resource/native conditions. Update `beforeFailurePolicy` provenance/version, companion policy version and numerical policy version (proposed next versions: before-failure 2 / companion 4 / numerical 4), with actual amendment time and canonical new proof hash/source **before controlled capture/head timing**. Change observed-paint proof provenance to the new actual raw observation; never invent a paint value or allow missing one of twenty entries.

Every numerical multiplier/allowance/floor remains identical. Keep the old policies in Git and old proof files byte-for-byte. The new active rule should reject d555/unknown binaries for its new eligibility, failed or unattempted prerequisites, missing metrics, query errors, caps, mandatory/upstream errors and failed head UI. Verify those cases through the existing offline CLI/eligibility seams before merging. Preserve explicit failed-before behavior cost/paint labels and null usable-content/clock failure p95; head stays all-pass.

Then add the **new** proof to transitive fingerprints while retaining the old proof chain, update the mutable full draft's runtime binary/observer/tooling fields, repeat exact C1 non-runtime equality and source fingerprint preparation, and replace the stale preparation sidecar with a newly named reviewed one. The existing scratch `prepare-c2-draft.mjs` deliberately still checks d555; update that narrow check only after the actual proof/binding amendment, not now. The old full-capture worksheet's d555/ac2 build assumptions and prior draft hashes are superseded for release execution: original and head both need admitted binaries containing the corrected observer. Refresh the head build record after root rebuilds it; do not derive against the old ac2 observer artifact.

Only then can root refresh/review the full worksheet and decide to freeze C2. No actual budget derivation until corrected complete original primary **and** companion evidence exists. No issue-close or PR-ready action is implied.

## Preparation checks completed

Merged c632; inspected the exact observer-only commit/diff and active d555-bound policy. The new diagnostic plan passed the installed runner's `--verify-journeys ... --validate-plan`. The finite copy passed `node --check`. No new runtime protocol or measuring implementation was introduced. Actual new-binary diagnostics, proof creation, prospective policy amendment, source fingerprint/draft refresh, full captures and budget registration remain pending.
