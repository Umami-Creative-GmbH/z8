# #1470 configured analytics operator

Status: **Configured variant built and admitted at source `4d8bdb1d477cd02888565816b0fb96f85dc13b71`; real browser journeys pending.** This artifact admission does not establish final-release source parity or any browser outcome.

The primary original/head comparison has an empty public PostHog token. Preserve that parity and its artifacts. This separate head-only production build uses the **real installed `posthog-js` SDK** with a synthetic public token and a count-only loopback HTTP sink. It establishes configured-consent behavior, not a before/head performance improvement. Nothing here proves a production/CDN deployment.

## Admission and ownership

Run only after the parent releases the runtime window and completes primary timings. Use a separate final-source worktree with real local pnpm dependencies, no `.env` files and no existing `.next` tree. Do not move or overwrite a primary artifact. The operator never deletes an artifact, changes a parent runtime, starts Docker or modifies the database directly.

Use the generated `runtime-private.json` from an owned disposable fixture clone, with `POSTGRES_HOST=127.0.0.1` and an `approval_workflow_repository_test_*` database. Do not pass Phase, a production environment, a real vendor key or an arbitrary deployment URL. The source commit must match the artifact worktree's HEAD at preparation. Public environment variables require compilation; changing a running server's environment cannot establish this gate.

The generated variant clears vendor upload keys, outgoing mail, Vault, billing, cron, tracing exports and inherited preload options. It pins `NEXT_DEPLOYMENT_ID`, local app/auth URLs, `NODE_ENV=production`, `CI=true` and two Next build workers (`CIRCLE_NODE_TOTAL=3`). Installed Next 16.4 writes the full `NEXT_DEPLOYMENT_ID` to `required-server-files.json:config.deploymentId`, while Z8 publishes its seven-character prefix in `config.env.NEXT_PUBLIC_BUILD_HASH` and `/api/app-version`. Admission independently verifies both fields against the recorded source commit. The separate private manifest contains generated fixture secrets: never print or commit it, cookies, action bodies, network bodies, console messages or raw logs.

Before navigation, `verifyAnalyticsArtifact` validates **every compiled `/ingest` rewrite**, including beforeFiles/afterFiles/fallback sections, against exactly these two rules:

| Source | Required destination |
| --- | --- |
| `/ingest/static/:path*` | `SINK/static/:path*` |
| `/ingest/:path*` | `SINK/:path*` |

An extra rule, vendor host, altered destination, nonfixture token, missing synthetic token in browser chunks, missing real SDK chunk, changed source hashes or wrong compiled deployment ID rejects the artifact. A browser request allowlist cannot prevent Next from forwarding a same-origin `/ingest` request to a vendor, which is why the compiled gate runs first. The browser also requires the operator's live launch PID/build manifest, matching `/api/app-version`, and matching served hashes of the actual token-bearing browser chunks.

## Parent commands

The following PowerShell variables are examples. Select unused loopback ports and a new private directory; prepare refuses to replace an existing private manifest. `artifactApp` must point at the **new** worktree's `apps/webapp`, after its real pnpm dependencies are installed. `sourceBuild` is its actual final HEAD. All commands run through pnpm from the integration repository; the helper builds/starts the separate artifact app.

```powershell
$operator = 'Y:/Codex/Worktrees/c412/z8'
$scratch = 'C:/Users/KaiHentschel/.codex/visualizations/2026/10/24/01a16d49-e92f-7142-8e11-9532addefaff/spec1448'
$parentRuntime = "$scratch/cache-candidate-runtime/runtime-private.json"
$variant = "$scratch/analytics-configured-runtime"
$artifactApp = "$scratch/wt-configured-final/apps/webapp"
$sourceBuild = (git -C "$artifactApp" rev-parse HEAD).Trim()
pnpm --dir "$operator" --config.verifyDepsBeforeRun=false node scripts/performance/analytics-consent-fixture.mjs prepare "$parentRuntime" "$variant" "$artifactApp" http://127.0.0.1:50870 http://localhost:50871 "$sourceBuild"
pnpm --dir "$operator" --config.verifyDepsBeforeRun=false node scripts/performance/analytics-consent-fixture.mjs build "$variant"
pnpm --dir "$operator" --config.verifyDepsBeforeRun=false node scripts/performance/analytics-consent-fixture.mjs verify "$variant"
```

The build runs the app's normal `pnpm run build`, including i18n metadata and license generation, then writes private build logs and `artifact-manifest.json` (source/config/SDK hashes and admission metadata). The launcher invokes standalone pnpm executables directly and JavaScript pnpm entry points through Node. Preserve both the manifest and actual build. In **separate parent-owned tool sessions**, start the sink and application, and retain their session IDs for recovery:

```powershell
pnpm --dir "$operator" --config.verifyDepsBeforeRun=false node scripts/performance/analytics-consent-sink.mjs "$variant"
pnpm --dir "$operator" --config.verifyDepsBeforeRun=false node scripts/performance/analytics-consent-fixture.mjs start "$variant"
```

`start` verifies the artifact again before launching Next, records its child PID and writes a private log. It does not rebuild. Stop only these owned sessions after all browser contexts are closed and evidence is saved; never stop the original/candidate collector or another agent's services.

## Sink contract

The installed SDK reviewed here is `posthog-js` **1.438.7**. Its `lib/src/remote-config.js` and `lib/src/entrypoints/external-scripts-loader.js` load `/array/{token}/config.js`, then fall back to `/array/{token}/config`; config is indexed under `window._POSTHOG_REMOTE_CONFIG[token].config`. `hasFeatureFlags: false` suppresses the optional flags read. The sink provides this real protocol, with no flags, site apps, surveys, product tours or session recording. An incidental `/flags/` or legacy `/decide/` returns empty flags/payloads. Capture endpoints return `{status:1}`. Other SDK assets return 404 and remain counted; the sink does not synthesize an SDK or recorder asset.

The sink drains and discards request bytes. It never parses events, cookies, identities or payloads and never writes request logs. `/__fixture_metrics` returns allowlisted numeric endpoint/request-byte counts only. There is no claim about event counts when bodies are not parsed, nor about initialization count from config/capture requests. Counts are cumulative across the sink lifetime: record before/after deltas for each case. Oversized requests and unexpected assets fail the journey gate until explained.

The browser uses this sink as a **rejecting proxy** for all nonloopback traffic in addition to page request interception. Absolute proxy requests and HTTPS CONNECT attempts receive 403; there is no forwarding code. Page attempts outside the fixture origin abort and are counted. Service workers and browser resource cache are bypassed for these explicit cold-resource probes; this differs from the primary timing protocol and must be recorded. Notifications alone are denied for the isolated synthetic browser context, matching the primary fixture permission policy. Geolocation is unchanged.

## Real browser probe interface

Import `openAnalyticsConsentBrowser` from `scripts/performance/analytics-consent-browser.mjs` in a private operator script run with `pnpm node`. It resolves the installed Puppeteer package through the artifact app. Pass `authFile` pointing at the owned fixture's existing private auth file and an actor alias such as `small-admin`; auth stays in memory. Cookies must belong to the configured localhost fixture host. No production login is supported.

```js
const session = await openAnalyticsConsentBrowser(variant, {
  authFile: `${scratch}/cache-candidate-runtime/auth-private.json`,
  actor: "small-admin",
  sdk: "hold", // "pass", "hold" or "fail"; fresh browser per case
});
try {
  await session.navigate(); // actual /en/settings/profile
  const originalConsent = await session.consent();
  // Preserve originalConsent privately BEFORE any save; see recovery below.
  const before = await session.snapshot();
  await session.saveConsent(false); // real switch + Update Profile submission
  await session.releaseSdk(); // release real SDK download; fail:true aborts it
  const after = await session.snapshot();
  // Publish only numeric deltas and independently verified outcome booleans.
} finally {
  await session.close();
}
```

The helper pauses/aborts the **actual compiled SDK resource**, discovered by its installed `__PosthogExtensions__` code marker and recorded SHA256. It never patches `posthog`, provider props, consent storage, page state or SDK methods. The returned real `page`/`context` allow native profile, org switch, sign-out, clock and navigation actions. `saveConsent` submits the real profile form; verify persistence in a fresh page/context and wait for actual refreshed layout/observable behavior. A successful HTTP response alone is not proof of consent propagation.

`snapshot` returns CDP's actual encoded bytes, SDK transfer bytes, request/completion/abort counts, page error count and native ScriptDuration/TaskDuration/LayoutDuration deltas, plus numeric sink counts. CDP encoded bytes include transport overhead; report that definition. These are cumulative observation-window metrics, not isolated SDK CPU attribution or an initialization counter. The helper does not manufacture missing observations or declare a case passed.

## Required journey record

Use fresh contexts and stable observation windows; retain failures. Record source/artifact hashes, viewport, permission/cache policy, action stage, clock readiness/outcome, draft/focus retention and numeric deltas. Inspect actual UI selectors before running; do not invent Server Action IDs, write session data directly, or replace the SDK to make a check pass.

| Case | Required real observations |
| --- | --- |
| Saved deny, fresh context | Profile switch persisted false; SDK attempts/completions and ingest attempts remain zero while clock/navigation work. |
| Allow | Real switch/save and refreshed layout load the actual SDK; local config/capture traffic appears; no page errors or repeated download on unrelated renders. Capture/config counts alone do not prove exactly one init. |
| Revoke after allow | Real switch/save persists false; local capture stops after any explicitly recorded in-flight traffic; clock remains usable. Record the actual profile save/refresh behavior. No promise rejection escapes. |
| Hold then revoke | Hold SDK before first navigation; real switch/save withdraws consent; verify refreshed state before release; releasing the actual SDK produces no stale config/capture traffic. |
| Failed SDK resource | Abort real SDK request, keep app/clock/navigation usable; unrelated renders do not produce unbounded retry/download/init attempts; retain actual failure/error counts. |
| Held identity departure | With SDK held, use actual org switch and actual sign-out controls, then release. No departed identity may start capture. Full-page org switch/sign-out can abort the pending resource: record that fact rather than claiming the old promise resolved. A new allowed identity can legitimately initialize its own lifecycle. |
| Configured signed out | Actual sign-out leaves no protected app UI or further capture from the departed layout; retain any pageleave/in-flight request timing separately. |
| Initial allowed download and unsaved profile draft | In a fresh context with saved consent true, hold the SDK resource, type an unsaved synthetic value in the real profile field, focus it, then release the SDK without submitting the profile. Verify actual DOM identity, value, focus and clock readiness. Discard the draft by navigation. |

Keep the unsaved-draft download case separate from consent persistence cases. Submitting the profile legitimately submits its fields; clicking outside a clock popover can legitimately close it. Neither action supports a claim that the same draft DOM must remain across that interaction. The real-provider tests separately cover draft and identity retention across consent changes. Do not save a draft canary or infer a remount from normal form/popover behavior. The helper performs no clock command: inspect the authoritative initial state, use real controls, record outcomes and restore it through real controls. Never retry a clock write with an unknown result. Clock readiness is `[data-clock-status="ready"]` with an enabled visible control; `pending`/`unavailable` is not ready.

Before the real org-switch case, the parent must verify that both source and target are owned synthetic organizations in this SDK fixture clone; the actor has approved membership and an active, eligible employee in both; the actual organization switcher lists both; and the initial active organization is recorded privately for restoration through that same control. If the fixture lacks a dual-org actor, the parent can create a guarded synthetic member/employee in the owned SDK clone **after all primary timings**. Never add membership/employees to the primary 200-row fixture while it is being measured. These operator scripts perform no database or membership mutation. Abort that case until the preflight is satisfied; do not substitute invented organization IDs or a production organization.

Deployment disablement in current source is `NODE_ENV=development`, already covered by provider tests. This production-only fixture cannot claim that separate disabled-state browser gate. The unconfigured original/head primary captures cover the empty token case; keep their numerical results distinct. Protected server exception forwarding is deliberately absent; do not induce a real protected exception or inject sensitive canaries into a public artifact.

## Recovery and remaining acceptance

Before the first consent save, record only the owned actor alias, original boolean and generated fixture directory in a **private** recovery file. On exit/failure, open a fresh authenticated real profile page against this variant, change only `#profile-help-improve-product` back to that boolean, submit **Update Profile**, then reopen and verify the persisted switch. Do not reset the whole profile, tenant, database, cookies, org membership or another actor. Discard only local unsaved test drafts. If signed out, obtain fresh auth through the existing owned fixture authentication command; never restore a session through direct database edits. Record unresolved restoration as a failed gate and leave the fixture intact for the parent.

The parent subsequently completed the configured CI build; strict artifact admission now passes for full source `4d8bdb1d477cd02888565816b0fb96f85dc13b71` and public hash `4d8bdb1`, including both loopback rewrites, source hashes, ten token-bearing chunks and one real SDK chunk. No rebuild, application launch, browser journey or database mutation occurred during the operator correction. The parent-owned sink is separate. Six finite operator tests pass, including actual installed pnpm invocation and wrong deployment/public-hash rejection. Complete the real matrix, publish redacted numerical evidence and retain failures before claiming #1470's browser/resource acceptance complete.
