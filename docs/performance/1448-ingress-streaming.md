# Local ingress streaming experiment

Issue [#1473](https://github.com/Umami-Creative-GmbH/z8/issues/1473), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

Status: **PREPARED; runtime acceptance pending.** No ingress/browser/database
experiment has run for this ticket. An active controlled baseline capture reserves
the runtime window. The checks below describe the prepared operator procedure,
not observed application performance or completed acceptance.

The user confirmed that deployed production/CDN access is unavailable and
authorized a local Docker fixture. This experiment reuses #1472's separate owned
PostgreSQL/Valkey/storage and actual Docker HAProxy 2.8 frontend, forwarding to two
parent-owned host Next.js production processes on loopback. Only that configured
topology can be verified. Actual deployed ingress and CDN behavior remain unknown.
The example Kubernetes ingress and Compose Caddyfile are unchanged. No buffering,
compression, shared cache or production infrastructure configuration was changed.

## Controlled secondary read

`performance:ingress` requires the #1472 private fixture manifest and an explicit
compiled source commit. Planning reads only local metadata. It rejects production
origins, source mismatches and source history predating the #1455 SSO admission
repair (`db51c13fa`). Runtime additionally checks actual Docker ownership and the
mapped PostgreSQL port, the frozen artifact manifest hash and BUILD_ID, the
actual database name and the eligible synthetic actor. The old `897b4077b`
artifact cannot establish final admission/streaming acceptance.

On the **separate disposable database**, the operator temporarily enables shifts
and a saved layout containing Quick Stats and Upcoming Shifts for `small-employee`.
Upcoming Shifts reads the actual `shift` table after authorization and the feature
check. Quick Stats and compact clock status do not depend on that scheduling
query. The default employee actor avoids Manager Today's separate shift lookup;
using a manager would deliberately hold more than one scheduling reader.

A dedicated transaction takes `ACCESS EXCLUSIVE` on `shift`, with a two-second
lock acquisition timeout, a planned eight-second hold, an independent twelve-second
safety release and a fifteen-second server-side idle transaction timeout. The
operator observes a real application backend blocked by its exact holder PID.
It does not ship a delay parameter, fake widget response or public fixture route.
Release and fixture restoration run in `finally`. The recovery file is exclusive:
an unfinished earlier variant must be restored before another run. A hard-killed
operator can use the explicit guarded `restore` command after the lock times out.

The failed-reader condition cancels only observed SELECT backends blocked by this
owned lock. It expects the real widget error treatment, keeps the successful
sibling and clock visible, releases the lock and retries through the visible
widget button using the keyboard. It does not cancel unrelated work or modify
canonical time records.

## Observations and limits

The prepared browser matrix covers 1280×900 and 390×844, first document and real
Link navigation, for both held and failed secondary reads. Link navigation starts
on time tracking with the persistent layout. Prefetch requests are suppressed and
browser caching is disabled so a prefetched Dashboard cannot defeat the deliberate
hold; these are explicit experiment conditions, not the ordinary warm-navigation
benchmark. Fresh browser contexts deny notification onboarding as in #1450.

Chrome CDP `Network.streamResourceContent` observes the **actual navigation
response**, including buffered bytes already received and subsequent chunks.
The initial document checks actual useful HTML outside scripts; the Link response
checks the explicit Quick Stats Flight payload. Visible DOM checks independently
require completed Quick Stats, the full SiteHeader's enabled known clock and the
secondary loading placeholder **before release**. A fresh authorized clock-status
GET must agree with the synthetic actor's Clock In trigger. Keyboard activation
must open the real header popover without issuing a clock mutation. The tool fails
if Chrome's response-stream API is unavailable; final-response inspection is not
substituted for early-content evidence.

Evidence includes chunk arrival/readiness observations, decoded content bytes,
CDP encoded body bytes, selected actual security/cache/compression response
headers, proxy image/config hash and compression/filter declarations, request
attempt count and native query/row/pool/event-loop metrics from the existing
observer. Bodies, cookies, passwords, employee/organization IDs and query text
remain in memory or private operator recovery/error files. Public summaries carry
only condition labels and booleans. CDP body-byte counts are not a TCP packet
capture or a complete JavaScript transfer budget.

Loading/completed widget rectangles are recorded for geometry review. They are
not automatically declared stable; visual/mobile/focus review remains required.
DOM polling time and received-chunk time are not browser-native paint, LCP or INP.
This functional experiment does not replace the spec's twenty-sample cold/warm
baseline or its resource/byte budgets.

Admission conditions use real authenticated synthetic cookies, then separately
exercise signed-out, expired MFA grace and required SSO through HAProxy. They first
confirm an allowed protected control, use fresh browser contexts, inspect the
actual denied document before following redirects, reject protected markup or
widget snapshots, require the expected challenge and deny the clock-status GET.
Only fixture policy/layout rows are changed; their prior values are saved and
restored. Legitimate authentication reads may create their normal fixture audit
or revision rows. No session token is minted and no authorization helper is mocked.

## Operator commands after the parent opens the runtime window

First provision/start/authenticate #1472's new isolated topology with an artifact
compiled from the final integration head, following its handoff. The parent owns
the long-lived collector and both Next processes. Do not run this against the
original baseline fixture or reuse the older artifact for final proof. Run these
conditions sequentially in an exclusive parent-scheduled window: the table lock
affects this whole disposable database, and admission variants temporarily change
the selected fixture organization's policy. Do not overlap #1472 load/cache probes.

```powershell
$ingressWt = 'ABSOLUTE_PATH_TO/wt-1473'
$ingressPrivate = 'ABSOLUTE_PATH_TO/multi-instance-runtime-final'
$ingressSource = 'FULL_FINAL_COMPILED_SOURCE_COMMIT'

# Read-only plan: starts no services and touches no database.
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:ingress plan $ingressPrivate $ingressSource

# One finite real condition; repeat viewport/mode/scenario as needed.
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:ingress run $ingressPrivate $ingressSource desktop first-document held
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:ingress run $ingressPrivate $ingressSource mobile repeat-link failed
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:ingress admission $ingressPrivate $ingressSource desktop mfa

# Full sequential real matrix: eight streaming cases plus six admission cases.
$env:Z8_PERFORMANCE_MULTI_DIRECTORY = $ingressPrivate
$env:Z8_INGRESS_EXPECTED_SOURCE = $ingressSource
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:test:ingress:runtime

# Only if an interrupted operator left an unfinished private variant.
pnpm --config.verifyDepsBeforeRun=false --dir $ingressWt performance:ingress restore $ingressPrivate $ingressSource small-employee
```

The runtime suite fails when its operator environment is missing; it is never
counted as passing or skipped. Three lightweight CLI safety cases have passed:
numeric-only plan, production-origin refusal and source mismatch/pre-repair
artifact refusal. The one-line #1472 launcher import repair passed its existing
two CLI safety cases. Node syntax checks pass. No runtime result, buffering
diagnosis, visual geometry claim or deployed CDN acceptance is recorded yet.

If useful content fails to arrive through the proxy before release, retain that
failed evidence. Compare the identical controlled request directly against the
owned replica and inspect the actual proxy configuration/compression before
changing anything. A minimal fixture fix requires a causal reproduction and
repeat validation. Example ingress annotations are not evidence or a remedy for
an unobserved deployed problem. #1473 remains open until runtime and parent review
gates are fulfilled; deployed production/CDN access remains explicitly unavailable.
