# #270 — early approval-card truthfulness correction

## Main-branch integration

The implementation was originally committed as `5762c7d7` on a dev-based branch.
For the requested merge into `main`, only that ticket commit was ported onto
`origin/main`; unrelated dev commits were excluded. Norwegian and Swedish bot
catalogs belong to an unrelated dev locale addition and do not exist on main.
The port therefore retains main's ten supported locale catalogs. The twelve-locale
and full-suite results below describe the original dev-based verification.
On the main-based port, typechecking, all 362 focused approval tests and all 29
Docker runtime checks passed again. PostgreSQL runtime evidence remains blocked.

## Scope and admission

Implements T06 of #264 under #259's **early-release** limits. Existing cards do
not carry a provable reviewed binding. All four existing send adapters therefore
prepare a minimal authenticated-inbox notice, not an actionable summary. This
does not admit a new kind, provider invocation protocol, or initial notification
route. The existing `approval_request_submitted` / `approval_request` routing
condition is unchanged; domain notifications using subject discriminators are
not silently switched to the previously bypassed card branch.

Preparation verifies organization, current compatibility assignee, active employee
and membership. Linked canonical stages additionally require a pending current
workflow/stage and recipient assignment. Missing or inconsistent entitlement
suppresses the notice. Infrastructure read errors are not classified as missing
facts by the preparation operation.

No requester/subject/category/project/attachment labels, free text, event values,
or timestamps are loaded into notices. Removing these reads, instead of doing
ID-only relational expansion, prevents foreign facts from appearing in degraded
output. In particular, the old Teams event-ID fallback and notes-as-corrected-time
claim are removed. Time callback discovery continues to use the existing scoped
requester-owned **work period**, never an event with the compatibility subject ID.

## Historical results and callbacks

Fresh actions from every existing unbound card require web review, including
Slack. Supported manual-submission/policy-clock-out historical semantic matching
is delegated to the existing ordinary-work owner. `historicalOnly` stops that
owner before fresh legacy mutation/bootstrap, and stops canonical execution after
exact receipt matching but before new decision work. New receipt reservations
must roll back in the existing enclosing transaction. Existing receipt keys and
fingerprint bytes are unchanged.

Historical responses identify only the verified earlier assignment action. They
do not reconstruct submitted/resulting work, claim whole-request finality, or use
the current actor/time as historical evidence. Missing historical support yields
review-required, not a new mutation or an invented result.

Slack and Telegram edits require the exact organization, request, recipient and
remote message identity. Discord replies are ephemeral to the invocation; Teams
uses a follow-up notice rather than choosing another recipient's first tracked
activity. This is not an all-message retirement/recovery guarantee. Historical
tracking statuses/timestamps are not rewritten as if a new decision occurred.

## Ownership and cleanup

No new database representation, evidence lifecycle, binding store, worker, delivery
owner or capture mechanism is introduced. Existing message tracking and privileged
lifecycle cleanup retain ownership. This correction does not run historical repair,
reconstruct evidence on click, or create additional durable recovery obligations.
The existing delivery limitations remain explicit below.

## Verification evidence

- Preparation → actual four adapter render/transport payloads is covered by
  `apps/webapp/src/lib/bot-platform/approval-adapters.test.ts`, consolidating the
  four former handler suites. Assertions expecting fresh unbound mutations,
  first-read/current-target presentation drift and render-time historical claims
  have been replaced with the cutover contract.
- The preparation interface covers entitlement denial and fact-free degradation.
- The same adapter suite retains Telegram webhook acknowledgment/error paths,
  checks failed/false historical response delivery, and connects each callback
  to the real ordinary-work owner for matching approval/rejection and mismatched
  rejection reasons. Scoped storage and runtime coordination remain controlled
  fixtures; this is not PostgreSQL verification.
- Ordinary-work operation tests cover legacy no-mutation and existing
  canonical/legacy/shadow/ready terminal/intermediate historical matching with
  historical-only access. Transition-engine tests cover missing-receipt refusal
  and exact receipt return before fresh decision work.
- These tests use controlled database/provider boundaries. Their in-memory
  transaction assertions do **not** prove PostgreSQL rollback or concurrency.
- New notice strings are present in all twelve existing bot locale catalogs;
  the actual bot translator resolves the German notices in a focused test.

### Final local checks (2026-09-14)

- `pnpm --filter webapp typecheck`: passed after review corrections.
- Focused adapter, ordinary-work owner and transition-engine suites: **362 passed**.
- `pnpm node --test docker/scripts/prepare-target-runtime.test.mjs`: **29 passed**.
  Removing the adapter's registry dependency also removed Tabler from the traced
  worker runtime; its generated manifest and lockfile were refreshed.
- Full webapp suite: **11,100 passed, 33 failed, 289 skipped** across 1,007 files.
  Two failures came from the new suite's cold dynamic import exceeding the
  per-test deadline and completing during the next test. Imports now warm in
  suite setup, and all 362 focused tests pass. The other **31 failures** concern
  unchanged translation catalogs/tests: root unnamespaced files, lifecycle
  placeholders, missing loading/correction/notification messages, SCIM copy,
  settings wording and the inbox details ICU string. The relevant files match
  the starting commit; no unrelated translations were rewritten. The full suite
  was not repeated after the focused fix.
- Full desktop suite: **12 Rust tests passed**, one subprocess fixture ignored;
  **2 Node tests passed, 1 failed** in the unchanged OrganizationSelector backdrop
  source check. Desktop files match the starting commit.
- The root `pnpm test` initially stopped at manifest drift. After fixing that,
  Turbo failed to spawn pnpm (`Exec format error`), so the webapp and desktop
  suites were run directly through their pnpm package scripts.
- PostgreSQL integration URL was cleared and PostgreSQL defaults pointed at a
  nonexistent socket for the full suite. No unrelated PostgreSQL server was used.

### Two-axis review

Standards review found missing notice catalogs and inconsistent duplicated query
fixtures. Spec review found lost dispatcher/failure coverage and mocked-only
callback-to-owner matching. Catalogs were added, query fixtures consolidated with
scoped `findMany`, dispatcher/failure cases restored, and real-owner callback cases
added. Runtime evidence blockers below remain unresolved.

A follow-up review required proof that the connected pending case could not pass
merely because an incomplete fixture threw after accidental fall-through. The
suite now instruments the fresh-decision coordinator and database mutation entry
points. Temporarily removing the legacy historical-only guard made the connected
Slack pending test fail on a recorded fresh-decision attempt; restoring the guard
returns it to green. This mutation check strengthens the source-level regression
test without claiming real PostgreSQL execution evidence.

## Unresolved completion / activation evidence

#270 remains incomplete as a runtime acceptance claim while these gates are
blocked. No Z8 database is available locally; the running database belongs to a
different project and is not a permitted verification target.

1. Actual PostgreSQL receipt reservation rollback, organization isolation,
   committed replay, concurrent source/assignment changes, and privileged purge
   interaction require restored Z8 access and authorized integration execution.
2. Actual provider delivery, stale-card retirement, transport failure recovery,
   and deployed old worker/consumer coexistence remain unverified. Existing
   best-effort adapters are not durable recovery. The later delivery-owner slice
   must supply complete identities/intents/leases/retries and all-message refresh.
3. Immutable submitted/result evidence, per-kind relationship/field provenance,
   reviewed bindings, exact-item authenticated navigation, and admission of new
   actionable cards remain dependent slices. No new evidence capture activates
   before linked lifecycle cleanup and participating-writer readiness.
4. The notice links to the existing authenticated **inbox**, not an invented
   exact-request route. Working sign-in return, organization switching and exact
   item navigation require the separately planned review-route integration and
   real browser verification. The link does not claim missing facts were repaired.
5. Historical classification/repair, configuration/writer participation, old
   consumer/worker drain, organization pilot and wider operational activation need
   the parent's required evidence and separate authorization. No source-only or
   mocked check satisfies these gates.
