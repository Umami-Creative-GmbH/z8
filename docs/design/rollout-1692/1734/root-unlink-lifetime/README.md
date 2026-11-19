# R051 / #1734 root unlink lifetime proof

The root correction shares pending unlink reservations across the actual overview
and personnel-file controls, and refreshes the original readers after an accepted
write outlives its opening. This archive records bounded acceptance on candidate
`3d64886be72c8935eb9dffff51d042bb426ff8dd`, tree
`8c3a3993377ebde26099a95c55a2f31855791364`. **R051 remains provisional;
`verifiedCommit` is null.** Latest VERIFIED remains
`a114c3392e2e9edb97069ddcce1c4e8d1d58c3c0`. Root owns the subsequent Git blob audit,
readiness, proof commit and integration decision.

The append-only [root report section](../../1734.md#root-integration-verification-and-unlink-lifetime)
adds this evidence without changing the worker's historical report or its limits.
[Source/config pins](source-pins.json), [payload index](evidence-index.json),
[test accounting](test-accounting.json), [verification manifest](verification-manifest.json)
and [outer seal](publication-seal.json) establish the archive boundaries.

## Source correction and original STOP

The immutable [original STOP](archive/merger-stop/HANDOFF.md) reproduced two unlink
transport calls while the first was unsettled after organization A→B→A remount.
Both exact premerge and merged consumer controls were red. Those were real
OrganizationContextProvider/QueryClient/component probes with mocked auth and
action transport. They establish an inherited remount reservation gap, with no
proof of duplicate persisted writes or authorization bypass. The STOP retains
7 case instances across 2 physical files: 4 pass and 3 fail, including the
premerge control. Its initial bridge-copy setup failure ran zero tests.

[Root checks](archive/static/checks.json) record the correction at
[`81a94f940b7b7fbd13a823665b993b616973b2ae`](https://github.com/Umami-Creative-GmbH/z8/commit/81a94f940b7b7fbd13a823665b993b616973b2ae),
merged as `a5b0f7d8ff912c30197b81ba6ffe574ef68d6215`. Incoming
`e194f9f367ff747ecab779ebd47c2ba34c684b84` was merged as
`eba7258abf1071997dd5e1c3ea13f08fb88b5a5b`. Root reports that the correction source
and candidate have the same application tree. This publisher made no Git operation.

The current [reservation hook](https://github.com/Umami-Creative-GmbH/z8/blob/3d64886be72c8935eb9dffff51d042bb426ff8dd/apps/webapp/src/components/absences/sick-notes/use-sick-note-unlink-reservation.ts)
and [permanent public tests](https://github.com/Umami-Creative-GmbH/z8/blob/3d64886be72c8935eb9dffff51d042bb426ff8dd/apps/webapp/src/components/personnel-file/sick-leave-unlink-lifetime.test.tsx)
link to that exact candidate. The identity-only reservation lives in a WeakMap keyed by the existing QueryClient,
with actor, organization and document identity. Both production unlink controls
share it; replacement controls observe it through useSyncExternalStore, and
runWithCleanup releases it on every promise outcome. It persists no payload and
introduces no default mutation retry. Its boundary is one QueryClient; it provides
no cross-tab/full-reload mutex or server cancellation/idempotency guarantee.

Accepted retired PersonnelFilePanel writes now invalidate the original real
self-marker, employee-count and document readers before the retired-feedback
guard. The permanent 8 public cases and independent 9 cases use real providers,
components and reader hooks with auth/action transport fakes. Server authorization,
organization scoping, storage and time policies remain unchanged.

The [root red/green reports](test-accounting.json) and
[identity debug clone](archive/static/unlink-identity-red.sanitized.log) retain the
observed failures, including pending cases in the observer red stage. Those root
stages were uncommitted intermediate test shapes. No source hash or missing
intermediate history is invented. Exact pinned STOP source copies and the final
permanent test snapshot establish the source boundaries that are available.

## Exact case accounting and static checks

| Evidence selection | Cases | Physical files | Result and overlap |
| --- | ---: | ---: | --- |
| Root final selected units | 509 | 70 | 509 pass, 0 fail, 0 skipped; inherited result |
| Fresh independent public probes | 9 | 1 | 9 pass, separately reported |
| Fresh protected rechecks | 40 | 5 | 40 pass; overlap root509, never additive |
| Fresh canonical sick-leave/sick-note PostgreSQL | 65 | 3 | 65 pass |
| Fresh protected payslip PostgreSQL | 20 | 1 | 20 pass |
| Fresh accepted distinct selection | 134 | 10 | Public9 + protected40 + PostgreSQL85 |
| Selected root-unit + fresh-PostgreSQL union | 594 | 74 | Root509 + PostgreSQL85; separate from fresh134 |

Across **all fresh attempts**, the [original accounting](archive/runtime/test-accounting.json)
and [case results](archive/runtime/test-results.json) retain 198 case instances:
197 pass and **1 initial fixture sequencing failure**, over 18 file executions
and 7 runs. The initial public8 attempt had 7 pass/1 failure. The run named
`public-final` was an unintended protected40 repeat and is not counted as new
public coverage. The full attempt multiset is not described as green.

Root observed Next typegen plus all 3 type projects passing, nine-file lint
passing, and bounded Doctor9 with 0 errors/0 warnings. Existing panels pass the
80-column CRLF profile; the two new files pass 100-column CRLF. Full100 formatting
still fails on 7 files and ordinary formatting still fails on 3 files. The
[quality command clone](archive/static/quality.sanitized.json),
[full100 log](archive/static/format-all-100.log),
[ordinary log](archive/static/ordinary.log),
[type log](archive/static/typecheck.log) and
[Doctor clone](archive/static/doctor.sanitized.log) preserve these boundaries.
No application check was rerun during publication.

## Bounded actual application evidence

[Independent observations](archive/runtime/runtime-observations.json) record normal
synthetic sign-in and organization activation, actual shared sick-note intake,
protected 68-byte exact download, self marker and My Documents access. One
synthetically held cross-view unlink exposed the selected pending control;
selected readers refreshed after acceptance with no retired success toast.
Actual relink restored the same document/absence link. The
[persisted readbacks](archive/runtime/readbacks.json) retain the premature
unconfirmed link attempt and the later accepted link; all 12 absence records and
history hashes remain unchanged from post-intake through final readback.

Real settings granted all-scope sick-note officer access: own employee excluded,
former employee visible. Real revocation with a draft open refused the write,
retained its draft, and persisted 0 refused-draft documents. The foreign target
was unavailable (404), with no document controls. The named-scope picker was
unpassed; actual all-scope grant is the accepted browser path. Canonical database
tests cover named/team/category scope. Holds and failures are synthetic transport
boundaries, with no live authorization-race guarantee.

The [late-read record](archive/runtime/late-read-confirmed.json) retained no stale
title while a new target was pending and after its empty result.
[Restored-current connected Next](archive/runtime/next-current.json) reports empty
compilation/config/session error arrays, one h1, 10 rows and the reloaded 18px
preference. [Native0.39.1](archive/runtime/native-current.json) records the actual
admitted target's React owner tree. Earlier wrong-tab/hook attempts remain in
[failed attempts](archive/runtime/failed-attempts.json). No auth state was copied,
restored, exported or minted; no runtime was launched for this publication.

## Captures and partial historical comparison

| State | Current | Historical consumers |
| --- | --- | --- |
| 1600 light, expanded, 18px | [Current](archive/runtime/current-desktop-expanded-light-18px.png) | [Historical](archive/runtime/historical-desktop-expanded-light-18px.png) |
| 1600 light, collapsed, 18px | [Current](archive/runtime/current-desktop-collapsed-light-18px.png) | [Historical](archive/runtime/historical-desktop-collapsed-light-18px.png) |
| 390 light, 18px | [Current](archive/runtime/current-phone-light-18px.png) | [Historical](archive/runtime/historical-phone-light-18px.png) |
| 390 light, record right edge | [Current](archive/runtime/current-phone-record-right-18px.png) | [Historical](archive/runtime/historical-phone-record-right-18px.png) |
| 2400 dark, expanded, 18px | [Current](archive/runtime/current-wide-expanded-dark-18px.png) | [Historical](archive/runtime/historical-wide-expanded-dark-18px.png) |

[Current layouts](archive/runtime/current-layouts.json),
[historical layouts](archive/runtime/historical-layouts.json) and
[phone navigation](archive/runtime/current-phone-nav-open-light-18px.png) retain
expanded/collapsed navigation, first Escape/focus return and keyboard access to
the named scrolling region. All 11 images are the released **96px bottom crops**,
copied byte-exact. Raw full viewports are excluded. Phone top/tail views are
partial. Shared development, Pets, Rendering and clock overlays remain visible.
Historical desktop local-record width was not correctly measured and is
uncertified. A native viewport is not true browser zoom, a physical device or
complete accessibility acceptance.

[Overlay pins](archive/runtime/overlay-pins.json) identify exactly two consumers
from `a904b3d19815bd511c67514fb48078cd4aec262f`: sick-leave page and overview.
The owned server was stopped for overlays and restoration. Shared metadata,
shell, children, auth and domain owners stayed current. This is a **partial
historical-consumer comparison**, not the whole prior application. Current
metadata cannot establish a historical two-h1 count. Both consumers were restored
byte-exact before connected current checks. Historical page bytes are not
reconstructed here; its recorded pin and exact commit link remain available in
the overlay record; the [exact historical page](https://github.com/Umami-Creative-GmbH/z8/blob/a904b3d19815bd511c67514fb48078cd4aec262f/apps/webapp/src/app/%5Blocale%5D/%28app%29/personnel-files/sick-leave/page.tsx)
is linked at its original commit.

## Preservation, byte provenance and read-only verification

[Preservation](archive/runtime/preservation.json) records 57 verified anchors,
13,577 raw tracked app/rollout/spec paths unchanged, frozen configs/lock,
3 physical dependency parents and 158 internal links unchanged, original STOP30
and inherited licenses125 unchanged. [Cleanup](archive/runtime/resource-cleanup.json)
records 3 removed bridges and zero owned runtime resources.

The payload is exactly36 safe public runtime files, 30 immutable STOP files,
24 selected root static artifacts, 15 current source snapshots and 36 config
snapshots. [Sanitization provenance](provenance/sanitization.json) labels 13 static
clones, with original raw bytes/hash, exact ordered replacement identities and
counts. Private replacement literals remain excluded; their hashes and derivation
are recorded. No original log, image, archive or source was rewritten. Payload
bytes are protected by the scoped [.gitattributes](.gitattributes). Working CRLF
bytes, LF digests and computed canonical Git blobs remain distinct in the pins.
Root separately audits actual Git blobs and the old report's LF canonicalization.

Run the reusable [read-only verifier](verify-proof.mjs) from the repository root:

```powershell
node docs/design/rollout-1692/1734/root-unlink-lifetime/verify-proof.mjs
node docs/design/rollout-1692/1734/root-unlink-lifetime/verify-proof.mjs --current-source
```

Default validates archived payload/pins without a historical worktree. Optional
current-source also compares current raw/LF source/config bytes. Both fully decode
PNG pixels, parse JSON/JSONC and module/TypeScript syntax, validate local Markdown
links and check the untouched report prefix. They never execute archived drivers,
run application tests, install packages or launch services. The payload index
excludes publication metadata; the outer seal excludes itself and is independently
bound by the parent handoff, avoiding circular self-seals.

Later work may legitimately make current-source validation drift, including the
older #1733 optional validator. All older proof pins remain unchanged. Full
production generation, Tolgee/catalog/provider/device/wrapper/truezoom acceptance,
exhaustive ABA transitions and a global four-path roster guard remain unpassed.
