# R039 / #1834 fresh merger handoff

Merge `bd160d9af22214d473ea603870cdc161572bbcad`, tree
`47beb676edcfeb47e277b7f3b5eab3ec83bb1c2a`, exactly matches the independently
computed merge tree. Parents are published root
`cabc162b5afa374ab8f4bbaeaf76b9e368faa04e` and incoming
`f38255ab9ee57f37e72cd76368855d3c3233abee`. No conflict resolution or source fix.

## Confirmed public finding

`WorkScheduleLoading` at page-client.tsx:120 omits the semantic page heading.
The assembled page exposes only the named status during both initial session
pending and a held administrator check. Two independent public-interface tests
fail because the accessible h1 "Set your work schedule" is absent. This violates
the canonical page-heading/loading contract; it is not an inferred authority gap.
No live runtime was started against this knownbad source.

`public.json` retains the full reds. `1834-merger-public.test.tsx` is the complete
diagnostic test file, originally placed beside the route's page test. It was
removed from source after execution. Copy it to the same route directory under
its basename to reproduce at the preapproved assembled page/session/action seam.
`public-cases.txt` retains only the independent cases. No production helper,
TanStack field, run-action helper or private arrival state was mocked.

Eight independent probes pass: queued real Continue is abandoned across Activity
reconnection and a new deliberate Continue succeeds; old Save/Skip refusals and
exceptions do not contaminate the fresh arrival and a deliberate retry works;
organization ABA retires old success while current refusal retains input and the
effective boundary; held autoskip cannot overlap and explicit retry recovers from
rejection; explicit Skip owns the command while Continue validation is queued.

## Fresh verification

- Compatibility: 177 actual files / 1,885 passed cases, zero failures. This includes
  29 schedule, 36 wellness and 72 Payroll component cases. The current intersection
  with the incoming exact 19-file selection contains 250 cases.
- Independent: one file, eight passes and the two heading reds. Occurrence-aware
  union is 178 physical files / 1,895 cases: 1,893 passed, two failed. Nested Vitest
  suite counters are not file counts. `unit-occurrences.json` stores each physical
  file + fullName + occurrence exactly once.
- Full Next route generation, app, workflow and smoke types pass. Three-source-file
  formatter-disabled lint/import checking passes. Explicit app-config CRLF and
  100-column CRLF profiles each fail with formatting-only diagnostics in all three
  incoming files; both raw logs are retained. No formatting fix was applied.
- Bounded changed Doctor against cabc162b: three files, zero errors, two warnings
  for effect state reset at page-client.tsx:58 and :170. These match the incoming
  reviewed lifetime reset pattern; no suppression or zero-warning claim.
- All 47 prior verified ancestors, latest product, wellness/Payroll corrections,
  required initial/F3 commits survive. All 141 incoming paths match incoming Git
  blobs exactly, and 13,975 unaffected prior paths match root. Canonical root
  service/actions, vacation authority/expectation guards, wellness arrival and
  Payroll focus source are unchanged. Compact manifest: `preservation.json`.
- Artifact audit: 45 JSON parses, five JS syntax checks, three PowerShell parses,
  16 complete PNG decodes and 11 report-relative links. Final page/fields runtime,
  native/usability and baseline capture source pins agree. All six matched captures
  have the expected width. Desktop/light and phone/dark after captures inspected.
- Static inventory: 172 templates = 153 persistent pages + 19 aliases; all 19
  aliases match their owning destination and remain byte-identical to initial dev.
  This proves source coverage, not runtime locale/query/access behavior.
- Source/report/JSON/script whitespace passes; full archive whitespace exits 2 on
  inherited tool-emitted raw logs. Archive files were never rewritten.

## Ownership and limits

The existing schedule Save/Skip service intentionally persists personal onboarding
progress only, ignoring hours/classification/effectiveFrom. There is no claimed
workScheduleSet, policy persistence, privilege grant, date calculation, history or
default replacement. Root's canonical orgAdmin reader supersedes the incoming
report's historical raw-role reader note; root service/actions stay unchanged.

Incoming browser/real-PG readback/native/Next and before/after evidence remains
inherited, with its exact historical-source qualifications. There is no fresh live
revocation, browser, native, Next, standalone PostgreSQL, provider, device, true
zoom, complete locale/catalog/build or global transition certification here.
The raw incoming verify-evidence.mjs was not executed: it writes tracked evidence
and expects older584 shared owners. `audit.mjs` independently reads the archive and
writes only this own temporary directory.

Physical dependency directories, all 158 direct internal package links, approved
lock and config hashes remain unchanged. Every pnpm invocation sets the false
environment guard and explicit CLI flag. The first sandboxed pnpm command was
blocked at the engine-store lock before execution; `public-store-lock.log` remains.
The approved invocation then ran. No install, repair, borrowed directory or config
overlay occurred. Initial merge-tree object-write permission failure was retried
only with normal sandbox escalation for the authorized Git operation.

No tracker/report/ledger/README/raw archive edits, source fixes, push, PR changes,
issue closure, dev merge or deployment. No fixture/browser/native/Next runtime was
created. Completed command sessions were quality91709, compatibility20577 and
audit36681. Temporary diagnostic source removed. `release.json` records the final
clean worktree, dependency and runtime-ownership checks.

RELEASE checkout/index/package/runtime ownership to root. Root owns correction,
verification disposition and publication.
