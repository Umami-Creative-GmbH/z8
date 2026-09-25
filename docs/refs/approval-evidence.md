# Canonical absence approval evidence — #287 / T23

Binding contracts: [#287](https://github.com/Umami-Creative-GmbH/z8/issues/287),
[#253](https://github.com/Umami-Creative-GmbH/z8/issues/253#issuecomment-5653232524),
[#257](https://github.com/Umami-Creative-GmbH/z8/issues/257#issuecomment-5654287041),
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
and [parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264).

## What this slice adds

A canonical absence approval (organization rollout mode `canonical` or `complete`
for `absence`) can now retain immutable evidence for its whole lifecycle:

| Evidence | Written by | When |
| --- | --- | --- |
| **Submitted revision** (`approval_submitted_revision`) | Absence submission owner (`request-absence-effect.ts`, web and mobile) via `captureCanonicalAbsenceSubmissionEvidence` | Same transaction that inserts the absence, canonical record and workflow, after the workflow exists and before the compatibility mirror |
| **Decision evidence** (`approval_decision_evidence`) | Transition engine calling the absence adapter's `recordDecisionEvidence` hook | Same transaction as the authoritative transition, terminal finalization and receipt, only for an executed (never replayed) `approve`/`reject` |
| **Submission activation outcome** | Submission owner | When routing approves/rejects during submission, recorded with a `system` actor and the submission key as receipt |
| **Reviewed binding** (`approval_review_binding`) | `issueReviewBinding`, called by bound Telegram card preparation (#290) | Opaque handle for one recipient, assignment and submitted revision |

Code lives in `apps/webapp/src/lib/approvals/evidence/`. Review preparation lives
in `apps/webapp/src/lib/approvals/presentation/absence-review.ts`.

### Submitted revision contents

- Organization, request cycle (workflow ID plus submission key), subject absence,
  subject employee, requester employee and the separately evidenced submitting
  user/employee.
- Logical coverage derived from the **raw request before normalization**:
  `full_day`, `half_day_periods` (genuine AM/PM input) or `explicit_partial`
  (entered wall-clock times, `overnight` flag, `wallClockZone: "not_captured"`).
  The lossy `absence_entry` AM/AM shape and the canonical synthetic UTC bounds
  are stored under `compatibility` with their encoding provenance, never as the
  requested coverage. Unclassifiable coverage throws `evidence_incomplete`.
- Request-time labels (employee, requester, submitter, category) kept separately
  from identities. No days deducted, payable hours or other policy quantity.
- A versioned material fingerprint (`absence:v1:<sha256>`) over identity,
  category and coverage only. Labels and compatibility encodings do not
  participate.

No free-text notes or sick details are copied into evidence.

### Decision evidence contents

Receipt linkage (idempotency key, actor and command fingerprints), stage and
assignment, the approver's own **assignment outcome**, the **request outcome as of
that operation** (an intermediate approval leaves it `pending`), the persisted
assignment resolution time, the event actor, IDs of the events produced, the
resulting absence status and the actor's label at decision time. The reason text
remains in workflow events only.

## Guarantees and ordering

- **Atomicity.** Capture failure throws inside the owning transaction. A
  submission without its revision, or a decision without its evidence, rolls back
  completely (absence, canonical record, workflow, transition, finalization,
  projection, outbox and receipt).
- **Receipt before fresh checks.** The engine's `claimCommand` still runs first.
  An exact committed replay returns before any evidence read or write, so a later
  material change or capture pause can never invalidate a committed retry.
- **Fresh checks after the receipt claim** (`preflightDecisionEvidence`): once a
  lifecycle has a submitted revision it is always enforced; while capture is
  active a lifecycle without one is held (`evidence_required`). Live
  `absence_entry` identity, category and stored coverage must equal the revision;
  otherwise `material_change` holds the decision before any transition is
  applied. A renamed category alone is a label-only change and stays decidable.
- **Reviewed bindings** supplied with a decision are validated against
  organization, recipient, workflow, stage, assignment and current revision under
  the decision transaction. A binding is never silently ignored: adapters without
  evidence support and legacy authority reject it.
- **Immutability.** Evidence rows reject `UPDATE` through a trigger. Ordinary
  edits, cancellation, soft deletion and later cycles do not touch them; they
  reference the absence by value and the workflow by FK.
- **Organization scope.** Every read/write filters by `organization_id`; composite
  FKs bind workflow, assignment, revision and employee references to the same
  organization.

Evidence errors surface to callers as `ConflictError` (`conflictType:
"approval_evidence"`, HTTP 409 in the inbox routes) except integrity
contradictions (`invariant`), which remain infrastructure errors.

### Material changes and resubmission

`sick-vacation-override.ts` can split or reject a *pending* vacation in place.
For an evidenced canonical absence that changes material facts without a new
submission, so decisions are held and the authenticated review explains that the
request must be cancelled and resubmitted (the existing supported path). No
amendment/reset workflow is introduced; this is the agreed hold.

## Review preparation

`prepareAbsenceReviewEvidence` loads the revision, compares it with live facts and
lists decision evidence. The web inbox detail (`getApprovalInboxDetailFromRequest`)
inserts a **Submitted request** section (historical labels, current category name
only when renamed, logical dates and coverage), a danger callout for material
change, a warning callout when capture is active but the request has no revision,
and an **Evidence history** timeline using persisted submission/decision instants.
Held requests disable approve/reject/bulk actions in the UI; the server holds them
regardless.

Bot cards stay review-only (#270) unless a provider is admitted. #290 adds
the first actionable path (Telegram, canonical absences); see "Telegram absence
cards" below. Discord and Teams remain #292–#293. Slack is never admitted; its
cards show the submitted facts without controls (#294, see
[Approval card delivery](approval-delivery.md)).

## Cleanup participation (before any capture)

- `deleteApprovalInTransaction` locks the evidence tables with the approval
  topology, deletes decision evidence, bindings and revisions for exactly the
  lifecycle's verified workflow links (never shared subject IDs), then deletes the
  workflows. `DeletedApprovalRecords.evidence` returns the removed IDs, so the
  CLI output and the atomic `force_delete_approval` platform-admin audit include
  them.
- The workflow FKs (`ON DELETE CASCADE`) also remove evidence if a workflow is
  deleted by another privileged path, and make a late capture for a purged
  workflow fail instead of recreating it.
- Whole-organization deletion removes all evidence and the control through the
  organization FKs. Source absences and their outcomes are preserved.
- Known ordering gap (not introduced here): `lib/jobs/organization-cleanup.ts`
  deletes `employee` rows before the organization and never deletes
  `approval_workflow` explicitly. The existing workflow/event employee FKs already
  block that step for organizations with canonical workflows; the evidence
  employee FKs are the same class. Reconciling the whole-tenant order is #306.

## Legacy-authoritative absences (#288 / T24)

Organizations whose `absence` rollout mode is `legacy`, `shadow` or `ready` keep
deciding through the legacy owners (`approval_request`, legacy chains). While
capture is active those owners now write the same immutable evidence, into the
same tables, marked `authority = 'legacy'` (migration
`0075_legacy_approval_evidence.sql`).

| Evidence | Written by | When |
| --- | --- | --- |
| Submitted revision | Legacy branch of the submission owner (`request-absence-effect.ts`) via `captureLegacyAbsenceSubmissionEvidence` | Same transaction, after the legacy rows (and any shadow observation plus its source binding) exist |
| Decision evidence (doubles as the legacy operation receipt) | Legacy branch of `executeAbsenceDecisionInTransaction` via `recordLegacyAbsenceDecisionEvidence` | Same transaction, after the legacy mutation and shadow mirror |
| Submission activation outcome | Submission owner | Requester auto-approval during routing, recorded with a `system` actor |

Code: `apps/webapp/src/lib/approvals/evidence/legacy-absence.ts`, with the rows in
`evidence/store.ts`.

### References stay truthful

- A legacy row never names a canonical workflow as its lifecycle
  (`workflow_id` is null, enforced by check constraint). It records the legacy
  rows it was captured for: the request routing created
  (`legacy_approval_request_id`) and, for policy chains, the chain instance.
- A shadow/ready observation is stored separately as `observed_workflow_id` (and
  the observed event IDs in the decision `result.observation`). Canonical
  loaders select by `workflow_id`, so an observation can never surface as, or be
  enforced as, canonical evidence. After cutover a legacy revision stays
  historical: the review shows it with a "previous approval process" notice and
  canonical decisions hold while capture is active (in-flight classification,
  blocker 2).
- Legacy decision evidence identifies the one legacy request it decided (the
  assignment equivalent) and, for chains, the chain stage. `stage_id`,
  `assignment_id` and `reviewed_binding_id` are null by constraint. A decision
  row always references a revision of the same organization and authority
  (composite FK).
- Legacy references are by value, because ordinary cancellation deletes pending
  legacy requests; evidence must neither block nor disappear with that.

### Facts, times and actors

- Submitted facts are built exactly as for canonical absences (raw coverage,
  labels, compatibility encodings, fingerprint). `submitted_at` is the persisted
  `absence_entry.created_at`.
- Decision outcome, stage and time come from the legacy rows re-read after the
  mutation, never from the requested action or a clock: `approval_chain_stage_
  instance.decided_at` for chains, otherwise `approval_request.approved_at`
  (approval) or the `updated_at` written by the same statement (rejection). The
  source is recorded in `result.decidedAtSource`. An intermediate chain approval
  records `request_outcome = 'pending'`.
- The actor is the authenticated operation actor; for chains the persisted
  `decided_by` must equal it. Auto-approval during submission is a `system`
  activation at the persisted `absence_entry.approved_at`. Reason text is never
  copied; only its hash enters the command fingerprint.
- A contradiction (unexpected outcome, other decider, request outside the
  evidenced lifecycle, conflicting observation, unsupported legacy rows) throws
  and rolls back the whole decision or submission.

### Operation matching and replay

- Legacy idempotency keys are unchanged
  (`absence:<absenceId>:<action>:<observedVersion|initial>:<sha256(reason)>`)
  and stored verbatim as `receipt_idempotency_key`; they still key the shadow
  observation events. Because the key repeats across chain stages and changes
  with the observed version, the legacy receipt is scoped to the decided legacy
  request (unique per organization and request).
- **Receipt before fresh checks.** With the exact legacy request ID (the inbox
  always supplies it), a retry whose actor fingerprint and versioned command
  fingerprint (`absence-legacy-decision:v1`: action, request, reason hash)
  match the committed row returns that historical evidence: no mutation,
  evidence write, observation, e-mail or notification. Anything else is not a
  replay and goes through the unchanged legacy owner, which still rejects an
  already-decided request. Without the request ID nothing is matched.
- Fresh checks then run before the legacy mutation: once a legacy revision
  exists it is always enforced (material change holds with the same 409 as
  canonical); while capture is active a lifecycle without one is held
  (`evidence_required`). Legacy authority still rejects reviewed bindings.

### Shadow observation fix

The legacy absence capture stored `approvedAt` as a Temporal `Instant` inside the
observed `sourceSnapshot`; the shadow mirror requires plain JSON, so every
shadow/ready absence **approval** failed as `malformed` regardless of evidence.
It is now canonical UTC text, as the time-correction capture already does. No
consumer read it as an `Instant`.

## Activation

Migration `0070_approval_evidence.sql` adds the four tables and the update trigger.
It inserts no control rows: capture is **inactive for every organization**.
Apply it before deploying this code: canonical absence submission, decision and
inbox detail read `approval_evidence_control` and fail if the table is missing
(an error, not permission to skip evidence).

The mode is read inside the approval transaction after the write gate holds the
shared rollout lock. An authorized adoption writer must change it while holding
the exclusive rollout lock, for example:

```sql
begin;
select pg_advisory_xact_lock(hashtextextended(
  'approval-rollout:' || length(:org) || ':' || :org || ':7:absence', 0));
insert into approval_evidence_control (organization_id, workflow_type, mode)
values (:org, 'absence', 'capture')
on conflict (organization_id, workflow_type) do update set mode = excluded.mode;
commit;
```

No application endpoint changes the mode.

### Activation blockers (all unresolved)

1. Apply migrations 0070 and 0075 through the normal authorized deployment
   (both have run only on the disposable PostgreSQL 16 test database, see
   Verification status).
2. **In-flight classification.** Enabling capture holds every pending absence
   without a revision of its deciding authority: canonical absences, and since
   #288 also pending legacy/shadow/ready absences submitted before capture. At
   cutover, pending absences with only legacy evidence hold under canonical
   authority too. Drain them first, or record provenance-bearing reconstructed
   revisions through a separately authorized preparation step (not implemented
   here).
3. Verify through the real caller boundaries with PostgreSQL: web and mobile
   submission, inbox single and bulk decisions, multi-stage intermediate approval,
   parallel races between decision and `sick-vacation-override`, replay after a
   material change, rollback at each write, tenant isolation, and privileged
   cleanup plus late-capture failure.
4. Confirm no old binaries decide canonical absences without the evidence hooks
   (pre-deployment binaries bypass them).
5. Whole-organization cleanup ordering (see above) must be reconciled and
   verified with PostgreSQL before production capture (#306). Legacy evidence
   carries the same employee FKs, so once capture is enabled for a legacy
   organization it joins the set that `organization-cleanup.ts` cannot delete.
6. Legacy absences (#288) remain unverified against PostgreSQL for: mobile
   submission (same owner, different caller), inbox bulk decisions, concurrent
   decision races (two approvers, decision versus `sick-vacation-override` or
   cancellation), `ready` mode, and old binaries without the legacy hooks
   (pre-deployment binaries decide without evidence or replay). Bots stay
   review-only; exact-item navigation (#289) and binding issuance for cards
   (#290) remain.
7. Limited organization pilot, then expansion (#328).

## Verification status

Local seams written with this slice (database/provider boundaries replaced):

- `evidence/absence-facts.test.ts`: coverage derivation for every input encoding,
  refusal to guess, fingerprint scope, label-only versus material comparison.
- `workflow/transition-engine.test.ts` (“canonical absence decision evidence…”):
  the concrete absence adapter through the real engine and state machine: capture
  inside the transaction before the receipt completes, replay without evidence
  reads/writes, rollback on capture failure, material-change and missing-evidence
  holds before any transition, inactive-mode compatibility, binding validation.
- `absences/request-absence-effect.test.ts`: capture receives the raw request and
  roles inside the submission transaction before the mirror; capture failure rolls
  back the whole submission.
- `presentation/absence-review.test.ts`, `inbox/detail-service.test.ts`: review
  sections, intermediate versus final outcomes, held actions.
- `maintenance.test.ts`: scoped evidence deletion order and reporting.

None of these is runtime evidence for the guarantees above. No migration was
applied and no PostgreSQL, browser or deployment check was executed. Keep #287's
runtime acceptance open until the blockers are resolved.

### #288 legacy authority

PostgreSQL 16 runtime evidence (`evidence/legacy-absence.integration.test.ts`,
run by `pnpm --filter webapp test:approval-workflow-repository:integration` on
a disposable, label-owned database with the full migration chain). The real
`requestAbsenceEffect`, `approveAbsenceEffect`, `rejectAbsenceEffect` and
`cancelAbsenceRequest` server actions run with the real legacy owners, write
gate, legacy capture, shadow mirror and store; only session, billing guard,
e-mail/notification delivery, calendar queue and work-balance marking are
replaced. Verified:

- `legacy` mode submission and approval: revision and decision rows, no
  canonical workflow created, verbatim legacy key, persisted decision time,
  no note or reason text stored; exact retry replays with no new row and no
  notification; a different retry is still refused; `UPDATE` rejected by the
  trigger; review preparation of legacy evidence.
- Rejection time from `approval_request.updated_at`; two-stage legacy chain
  with an intermediate `pending` outcome and per-stage rows under one shared key.
- Material change and missing-revision holds leave every row unchanged;
  capture inactive writes nothing.
- An injected insert failure on either evidence table rolls back the legacy
  decision (request, absence, canonical parity, audit) or the whole submission
  (absence, request, time record); the request is decidable afterwards.
- Requester auto-approval recorded as a `system` activation.
- `shadow` mode: observation stored separately and not visible to canonical
  loaders; approval mirrors (after the snapshot fix) with observed event IDs
  that exist.
- Organization scoping of loaders, replay and review; composite FKs refuse
  cross-organization and cross-authority rows.
- Evidence survives cancellation, stays listed, and privileged cleanup removes
  exactly one lifecycle (by legacy request, or by revision after cancellation)
  while preserving the other cycle and the business record.

Unit seams: `evidence/legacy-absence.test.ts` (replay matching, holds,
contradictions, chain outcomes, observation checks, activation),
`server/absence-approvals.test.ts` (receipt → preflight → mutation/mirror →
evidence ordering and rollback), `request-absence-effect.test.ts` (capture after
the legacy rows and observation binding; rollback), `presentation` and
`maintenance` tests. Not executed: deployment, browser, the blocker 6 items.

## Expense submissions and receipt identity (#295 / T31)

Travel expense approvals are decided only by the legacy owners (there is no
canonical `travel_expense` adapter), so a submitted claim is frozen as a
**legacy** submitted revision in the same tables, linked to the approval request
routing created. Capture follows `approval_evidence_control` for
`(organization, 'travel_expense')` and is inactive everywhere until an
authorized adoption writer enables it (same SQL as above, with the lock scope
suffix `:14:travel_expense`). Apply migration
`0078_travel_expense_submission_evidence.sql` first.

Code: `lib/approvals/evidence/travel-expense-facts.ts` (facts, fingerprint,
comparison), `travel-expense-submission.ts` (capture), rows in `store.ts`;
upload coordination and cleanup in `lib/travel-expenses/receipt-upload.ts`.

### What is captured, and by whom

| Evidence | Written by | When |
| --- | --- | --- |
| Entered logical trip dates and interpretation zone (`travel_expense_claim.trip_start_date`, `trip_end_date`, `trip_date_time_zone`) | `createTravelExpenseDraft` | Always, with the draft. The zone is the effective zone that also derived the compatibility `trip_start`/`trip_end` bounds |
| Server content checksum and provider object version (`travel_expense_attachment.checksum_sha256`, `storage_version_id`) | Upload route via `finalizeTravelExpenseReceiptUpload` | Always, over the exact bytes stored. Keys are write-once (`…/<attachmentId>-<name>`) |
| Submitted revision (`approval_submitted_revision`, `authority = 'legacy'`, `workflow_type = 'travel_expense'`) | `submitTravelExpenseClaim` via `captureTravelExpenseSubmissionEvidence` | Same transaction that locks, submits and routes the claim; only while capture is active |
| Submission activation outcome | Same | When routing auto-approves (requester is approver): `system` actor at the persisted `travel_expense_claim.decided_at` |

Submitted facts: claim, subject/requester employee (the claim owner) and the
separately evidenced submitter; claim type; logical trip dates with
`interpretation: { source: "entered_logical_dates", zone }`; the persisted
original and calculated amount/currency pairs verbatim; destination; and the
**receipt manifest**: per attachment the exact claim relationship, storage
provider/bucket/key/version and server checksum, sorted by attachment ID. The
compatibility UTC bounds and project ID are kept but are not material (the
project FK can clear itself). Labels hold request-time names, the project name
(same organization only) and receipt file names. Notes, receipt contents and
reimbursement, tax, exchange-rate, mileage or per-diem calculations are never
stored or inferred. The material fingerprint is `travel_expense:v1:<sha256>`;
changing a receipt's content identity changes it even when the count does not.

Incomplete evidence throws `evidence_incomplete` and rolls back the whole
submission (claim status, approval request/chain, revision), and the employee
is told why: a draft created before logical dates were recorded (`trip_dates`;
the current timezone is never used as a substitute), a receipt uploaded before
checksums existed (`receipt_checksum`), a receipt outside private storage, a
receipt claim without receipts, or malformed persisted money. An attachment row
of another organization or claim is an integrity contradiction (`invariant`).

### Upload and submission coordination

- The upload route **stages** a `travel_expense_receipt_upload` row (committed)
  before storing the private object, then finalizes in one transaction that
  takes `SELECT … FOR UPDATE` on the claim. Still the uploader's draft: the
  attachment is inserted and the staging row removed. Otherwise nothing is
  attached, the row becomes `cleanup_required` (`claim_not_draft`) and the
  route answers 409. The client no longer retries 4xx answers.
- Submission acquires the shared `travel_expense` rollout lock, then the same
  claim row lock, and only then reads the receipt set. An upload therefore
  either attached before submission read the manifest or is rejected after it.
  The receipt count check outside the transaction is gone.
- Rejected, failed (`finalization_failed`) and abandoned (`pending` for more
  than an hour) objects are deleted by `runTravelExpenseReceiptCleanup`: once
  right after a rejection, and by `cron:travel-expense-receipt-cleanup` every
  15 minutes. Work is leased, deletes the recorded object version, never deletes
  a key referenced by an attachment, and on failure keeps the row with its last
  error and backoff (1 min, 5 min, 30 min, 2 h, then 12 h; never dropped).
  Staging rows keep organization and claim by value so cleanup outlives claim
  and tenant deletion.

### Material changes and decisions

A claim leaves draft once and there is no expense amendment or resubmission
path. `preflightTravelExpenseDecision` therefore compares every claim that has
a revision with its live rows, inside the decision transaction. A changed
receipt set, date, amount, type, destination or identity, or live rows that can
no longer be verified, returns a 409 `approval_evidence` conflict and the claim
stays pending; the supported successor is a new claim. Decision evidence,
review presentation, bindings and the `evidence_required` hold for claims
submitted before capture are added by #296 (see "Expense review, decisions and
cards" below).

### Cleanup participation

Expense revisions and activation outcomes are ordinary legacy evidence: listed
as `legacy_evidence` and removed by privileged `deleteApproval` through their
legacy request (or revision ID), preserving the claim, its attachments and other
claims. Whole-organization deletion cascades them through the organization FK,
with the same employee-FK gap as above (#306). Deleting a claim through an
employee/organization cascade still leaves its stored receipt objects
(pre-existing, not introduced here).

### Activation blockers (#295, unresolved)

1. Apply 0078 through the authorized deployment (it has run only on the
   disposable PostgreSQL 16 database).
2. **Historical drafts.** Drafts created before 0078 lack logical dates, and
   receipts uploaded before it lack checksums. With capture on they cannot be
   submitted and must be recreated; classify or drain them first. Claims
   submitted before capture have no revision; since #296 they are held
   (`evidence_required`) while capture is active.
3. Old binaries attach receipts without the claim lock or checksum and submit
   without capture; drain them before relying on manifests.
4. The web UI does not expose receipt upload or claim submission yet (only the
   server action and route exist), so the 409 message is not browser-verified.
5. **Storage immutability is not enforced by the provider.** On a bucket
   without versioning `versionId` is null and the only protection is the
   write-once key convention: `PutObject` is not conditional, and decision-time
   comparison re-reads database rows, not objects. The checksum is computed over
   the bytes sent, not confirmed by the provider (`ChecksumSHA256` is not sent).
   Before activation, require bucket versioning (or conditional writes) for
   receipt storage. Object storage was an in-memory stand-in in the runtime
   suite; real version IDs, versioned deletes and the bucket-mismatch refusal
   are unverified.
6. **Abandoned objects on versioned buckets.** A process that dies after storing
   but before finalizing leaves no recorded version, so cleanup deletes by key,
   which on a versioned bucket only adds a delete marker. (A slow upload whose
   row was already swept re-records itself with its version; that path is
   covered.)
7. **Held claims have no durable attention.** A materially changed claim is
   refused for both approve and reject and there is no expense cancellation
   path, so it stays `submitted` until authorized cleanup (`deleteApproval`)
   or a separately agreed repair. No administrative-attention record is raised.
8. Whole-organization cleanup ordering (#306), then a limited pilot (#328).

**Not gated by capture.** These ship active on deploy, as bounded corrections:
logical-date columns on new drafts, upload staging with checksum/version,
the claim-lock coordination with its 409 for late uploads, the in-transaction
receipt check, and the cleanup cron (it only touches staging rows this code
creates). Only revision capture and the decision-time material-change check
(which needs a revision) depend on `approval_evidence_control`.

### Verification (#295)

PostgreSQL 16 (`lib/travel-expenses/expense-submission.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
`createTravelExpenseDraft`, upload route, `submitTravelExpenseClaim`,
`approveTravelExpenseClaim`, cleanup worker and maintenance, 13/13 passing:
capture inactive versus active; full revision contents and the checksum over the
stored bytes; organization-scoped loading and the update trigger; a late upload
rejected with its object deleted; a failed immediate cleanup recovered by the
worker after backoff; upload/submission races in **both arrival orders** behind
a held claim lock; an injected revision insert failure rolling back the
submission; historical date and checksum gaps held; missing receipts, a
foreign-organization attachment row refusing submission, and an empty mileage
manifest; a receipt-set change holding approval until reverted; self-approval
activation evidence; privileged cleanup of one lifecycle; abandoned staging
cleanup that never deletes an attached object; a slow upload re-recorded with
its version after its row was swept. Unit seams: `travel-expense-facts.test.ts`,
the upload route and submission action tests.

## Expense review, decisions and cards (#296 / T32)

Expense claims are decided only by legacy authority. #296 adds the review,
decision evidence, bound cards and delivery for them without creating canonical
authority. Everything is **inactive for every organization**: migration
`0093_legacy_expense_presentation.sql` inserts no control rows. Apply it after
`0092`.

```text
submitTravelExpenseClaim (tx)                    #295 capture, then
  recordLegacyDeliveryIntent("submitted")         only while a delivery control exists
after commit: kickApprovalDelivery

inbox handler / expense page / bound card        one owner: executeTravelExpenseDecisionInTransaction
  rollout lock (shared, travel_expense)
  bound: invocation lock → committed? replay | conflict (no current state read)
         presentation control still actionable? rollout not canonical?
  target = bound legacy request | caller's request | actor's own pending request
  authenticated with explicit request: exact semantic replay?
  frozen submission: material_change → 409   none while capture → evidence_required (409)
  bound: legacy binding names this actor and the current revision
  unchanged legacy mutation (processApprovalWithCurrentEmployee, "existing")
  legacy decision evidence (+ reviewed binding) → approval_invocation → delivery intent
after commit (not on replay): requester notification, kickApprovalDelivery
```

Code: `lib/approvals/evidence/travel-expense-decision.ts` (facts of the decision,
replay, holds, record), `lib/approvals/server/travel-expense-approvals.ts`
(owner, web effect, bound decision), `lib/approvals/presentation/travel-expense-card.ts`
(card facts, bound card), `lib/approvals/presentation/travel-expense-review.ts`
(web review sections), legacy bindings in `evidence/store.ts`.

### Decision evidence

Every decision on a claim with a frozen submission writes one legacy decision
evidence row in the transaction of the legacy mutation. It doubles as the
operation receipt of the one legacy request it decided.

- Outcome, stage and time come from the persisted rows afterwards:
  `approval_chain_stage_instance.decided_at` (and its `decided_by`, which must be
  the actor) for chain stages, otherwise `approval_request.approved_at` or, for a
  rejection, `approval_request.updated_at`. The request outcome is the claim's
  status as of the operation: an intermediate chain approval leaves it
  `pending`. `result` records `claimStatus`, `legacyRequestStatus`,
  `decidedAtSource` and `actorAuthority` (`assigned_approver` or
  `other_authorized_approver`: a single-stage request keeps its assigned approver
  when another authorized approver decides it).
- Nothing is inferred: another outcome, another decider, a missing persisted time,
  or a request outside the frozen submission's lifecycle rolls the decision back.
- The reason enters only the command fingerprint
  (`travel-expense-legacy-decision:v1`); no reason text, note, reimbursement or
  payable amount is stored.
- Keys: an authenticated decision is keyed
  `travel_expense_claim:<claim>:<request>:<action>:<sha256(reason)>`; a card
  decision by its provider invocation (`approval-invocation:v1:…`). A semantic
  retry matches only a semantic receipt with the same key, actor and command,
  so neither kind can replay the other. Nothing is matched without the exact
  request.
- Claims submitted before capture have no revision. Without capture they are
  decided as before and no evidence is written; with capture they are held
  (`evidence_required`), never reconstructed from live rows.
- Holds and binding refusals surface as `ConflictError` (`conflictType:
  "approval_evidence"`, `details.code`); integrity contradictions stay errors.
- The existing decision owner is unchanged: the same legacy request update,
  chain progression, claim status and decision log, now run inside the owner's
  transaction. Expense decisions now also take the shared `travel_expense`
  rollout lock.

### Legacy reviewed bindings and invocations

`approval_review_binding`, `approval_decision_evidence` and
`approval_invocation` now carry an `authority`. A legacy binding names the
recipient, the exact legacy request (the assignment equivalent, by value) and
the legacy submitted revision; it never names a workflow, stage or assignment
(check constraints). Composite FKs keep a binding, the decision it was reviewed
through and the invocation on the same authority, so a legacy handle can never
decide under canonical authority or the other way round.
`attemptBoundBotApproval` routes a handle by its authority; the canonical
loader returns nothing for a legacy handle.

A bound expense decision is valid only when all hold under the transaction: the
invocation is new, the provider is still admitted, the kind has no canonical
rollout, the binding belongs to the actor, the actor is the current approver of
the exact bound request (no eligible-manager or management authority), the
request is pending and part of the frozen submission's lifecycle, and the
binding names the current revision, which still matches the live claim and
receipts. Otherwise nothing is decided and the card becomes a review notice.
The invocation row is written with the decision evidence it committed.

### Card facts and admission

`buildTravelExpenseCardFacts` builds platform-neutral facts from the frozen
submission only (#253 §3): employee, submitter when different, claim type,
logical trip dates (never shifted), **Claim amount** (persisted value and
currency in the recipient's number format, never converted or re-rounded),
original amount when different, destination and project when present, the
receipt count for receipt claims, and the submission instant in the
recipient's zone. Notes, receipt contents and file names stay in authenticated
review. A missing essential fact (employee label, claim type, trip dates, money,
receipts of a receipt claim) makes the card review-only.

`prepareBoundTravelExpenseCard` issues a binding only when every gate holds:
the request is pending and assigned to the recipient, no canonical rollout for
`travel_expense`, `approval_evidence_control` = `capture` and
`approval_presentation_control` = `actionable` for `(organization,
travel_expense, provider)`, the claim is submitted, its frozen submission still
matches and the request belongs to its lifecycle, the facts are intelligible
and the card fits the provider. Only Telegram is an admitted adapter; Discord,
Teams and Slack stay review-only (#292–#294).

### Authenticated review

The inbox detail (and so the exact-item review page, #289) shows a **Submitted
claim** section from the frozen submission: employee, submitter, claim type,
logical trip dates with the zone they were entered in, claim and original
amounts, destination, project and receipt file names. A material change is a
danger callout, and a claim without a frozen submission is a warning callout
while capture is active; both disable approve, reject and bulk actions, as the
server does. The **Evidence history** timeline separates an intermediate step
("Approval recorded — awaiting further approval") from the claim outcome, with
persisted times and actors. The inbox list shows the logical trip dates instead
of dates derived from the UTC bounds; claims created before #295 show none. The
expense detail now loads the exact approval request (a chain has one per stage)
within the claim's organization.

### Delivery

With a delivery control for `(organization, travel_expense, telegram)` the
approval delivery owner sends the approver's card and keeps it current; see
[Approval card delivery](approval-delivery.md), "Legacy lifecycles". Without a
control nothing is sent, as before (expense submissions never notified the
approver).

### Cleanup

Privileged `deleteApproval` follows the lifecycle's legacy requests and
revisions. It deletes legacy delivery work, messages and intents before the
requests, and legacy invocations, decision evidence and bindings before the
revisions. They are reported as `evidence.invocations`, `evidence.reviewBindings`,
`delivery.work`, `delivery.messages` and `delivery.intents`. A late redelivery of
a purged press finds no binding and recreates nothing. The claim, its receipts
and other claims are preserved.

### Activation

Apply `0093`, then, as the authorized adoption writer and under the exclusive
rollout lock of the kind (scope suffix `:14:travel_expense`), after capture is
active (#295):

```sql
begin;
select pg_advisory_xact_lock(hashtextextended(
  'approval-rollout:' || length(:org) || ':' || :org || ':14:travel_expense', 0));
insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
values (:org, 'travel_expense', 'telegram', 'actionable')
on conflict (organization_id, workflow_type, provider) do update set mode = excluded.mode;
commit;
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'travel_expense', 'telegram');
```

No application endpoint changes either control.

### Activation blockers (#296, unresolved)

1. Apply `0093` through the authorized deployment. It has run only on the
   disposable PostgreSQL 16 database.
2. **Old binaries.** Instances without this release decide expenses without the
   rollout lock, evidence, replay or holds, and write no delivery intents. Drain
   them before enabling capture or any control.
3. **In-flight classification.** Enabling capture holds every submitted claim
   without a frozen submission (`evidence_required`). Drain them, or record
   provenance-bearing reconstructed revisions through a separately authorized
   step (not implemented).
4. **Held claims have no durable attention.** A materially changed or
   unevidenced claim is refused for approve and reject and stays `submitted`;
   no administrative-attention record is raised (#253 §5.3) and there is no
   expense cancellation path (see #295 blocker 7).
5. **Reassignment has no replacement card.** A legacy expense request moved to
   another approver makes the former card stale (verified), but no owner sends
   the new approver a card: there is no legacy escalation for expenses and
   replacement delivery is #300.
6. Only Telegram is verified. Teams actions (#293) share the same bound path,
   so a `travel_expense`/`teams` presentation control would make expense cards
   actionable there, but that is unverified: do not admit it. Discord and Slack
   stay review-only (#292, #294). No in-app or e-mail approver notification is
   added.
7. **Ingress.** No durable acceptance before the webhook acknowledgment.
8. **Legacy lifecycle identity.** Delivery treats one expense claim as one
   lifecycle (a claim leaves draft once) and versions it as one plus its
   decided legacy requests. A kind with several submission cycles per source,
   such as legacy absences (#384), needs a cycle-specific key; the legacy
   request FKs of delivery rows also cascade on cancellation, which deletes
   pending absence requests.
9. Everything in the #295 blockers (storage immutability, abandoned objects,
   historical drafts), whole-organization cleanup ordering (#306; legacy
   bindings carry the same employee FK) and the pilot (#328).
10. The approval write-boundary scanner cannot read sources on Windows. The new
    writers (`delivery/intents.ts`, the intent expansion in `delivery/store.ts`,
    maintenance deletes) are registered but were not scanned.
11. No browser check: the review sections were verified through the real
    arrival and detail API, not the rendered page.

### Verification (#296)

PostgreSQL 16 (`lib/travel-expenses/expense-review-decision.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
draft/upload/submit actions, exact-item review arrival and inbox detail API,
expense decision actions and inbox handler, delivery owner, Telegram webhook,
shared bot attempt and privileged maintenance. Only the session,
notification fan-out, object storage, the vault, the post-commit fast path and
the Telegram transport are replaced. 12/12 passing:

- review of the frozen claim (logical dates and entry zone, amounts, receipts,
  no notes), a receipt-content change shown and held, and a claim submitted
  before capture held (`evidence_required`) with nothing decided;
- a web approval recorded from the persisted rows (time from `approved_at`,
  actor, request outcome, semantic key); the exact retry replays with no
  evidence or notification; a different command is refused; the history keeps
  the submitted amount after a later source edit;
- a rejection at `updated_at` without the reason;
- no delivery control → no intent and nothing sent; no admission or no capture
  → a review-only notice and no binding;
- a real submission commits its intent and sends nothing until the owner runs;
  the owner sends one bound card (facts, exact review link, no notes or file
  names) and records the legacy message, binding and status version;
- a Telegram press decides with an atomic legacy invocation; the redelivered
  query replays; the same query with another command conflicts; a new query
  decides nothing; the owner refreshes the card to "Request approved" without
  controls; the committed press still replays after a source edit;
- a two-stage chain: the stage-one press is "Approval recorded" with the claim
  pending and chain-stage time; stage two gets its own card in the recipient's
  locale; after the web approval both cards reach the final status and the
  history separates the step from the claim outcome;
- a web rejection refreshes the delivered card;
- a changed receipt set, a paused provider, a reassigned request, another
  tenant and another member all decide nothing; the same card then decides;
- an injected invocation failure rolls back the whole decision (request, claim,
  evidence, notification), and the same query then decides freshly;
- three concurrent deliveries of one press produce one decision;
- privileged cleanup removes and reports the lifecycle's revision, decision,
  binding, invocation and delivery work, messages and intents, keeps the other
  claim, and a late press recreates nothing.

The #295, #288, #290 and #291 suites still pass on the same runner (the #291
cleanup report now includes `delivery.intents`), and the migration recovery
check passes with `0093` in the chain. Unit seams: `travel-expense-decision.test.ts`,
`travel-expense-card.test.ts`, `travel-expense-review.test.ts`, the handler,
action and maintenance tests.

## Telegram absence cards with reviewed bindings (#290 / T26)

A canonical absence card on Telegram can carry Approve/Reject controls bound to
the recipient's exact pending assignment and the current submitted revision.
The decision is revalidated in the transaction that commits it, and every
Telegram callback query is recorded as one invocation. Admission is **inactive
for every organization** (migration `0081_approval_invocation.sql` inserts no
control rows).

```text
sendApprovalMessageToManager(provider "telegram")
  prepareApprovalPresentation → prepareBoundAbsenceCard   (presentation/bound-card.ts)
    all gates hold?  no → unchanged review-only notice
    issueReviewBinding(recipient, workflow, stage, assignment, revision)
    facts from the submitted revision only; buttons carry {"a":"ba"|"br","b":<binding>}

webhook update → handleBoundApprovalCallback               (telegram/approval-handler.ts)
  invocation = telegram-bot:<bot id> + callback_query.id; update_id kept as delivery
  attemptBoundBotApproval                                   (bot-platform/approval-decision.ts)
    decideBoundAbsenceInvocation                            (server/absence-approvals.ts)
      committed invocation? replay / conflict (no current state is read)
      approved member; binding (org-scoped) must name this actor; absence by workflow
      executeAbsenceDecisionInTransaction
        rollout gate → invocation advisory lock → committed invocation? replay / conflict
        provider admission reread (paused → nothing decided)
        engine: receipt key from the invocation, exact bound assignment,
                authority = active assignment only, adapter asserts the binding
        decision evidence → approval_invocation row (same transaction)
  edit the clicked, tracked message; answerCallbackQuery text = outcome title
```

### Admission gates

A card is actionable only when **all** of these hold at preparation, otherwise
the existing review-only notice is sent:

- absence rollout mode `canonical` or `complete` (legacy-authoritative absences
  have no bindable assignment and stay review-only);
- `approval_evidence_control` = `capture` for `(organization, absence)`;
- `approval_presentation_control` = `actionable` for
  `(organization, absence, telegram)`; Slack is refused by a check constraint;
- a pending workflow whose current stage has the recipient's pending assignment;
- a current submitted revision that still matches the live absence (a
  label-only category rename is shown as "current category name");
- the essential labels (employee, category) exist and the card fits one
  Telegram message (4096 characters). The fit is checked before a binding is
  issued, so an oversized card leaves no unused binding.

The card shows the request-time employee, requester and submitter where they
differ, category, logical dates in the recipient's locale (never shifted by a
zone), coverage (full days, genuine half-day periods, or entered times labelled
"zone not recorded") and the submission instant in the recipient's zone and
hour cycle, labelled with that zone. Notes stay in authenticated review. The
review button opens the exact compatibility request (#289).

### Invocation identity and replay

- Identity is `(organization, telegram_callback_query v1, telegram-bot:<numeric
  bot id from the token>, callback_query.id)`, kept opaque. `update_id` is
  stored as `delivery_id` of the committing delivery and is not identity. A
  callback without a query ID, sender or recognizable bot token is review-only.
- The engine receipt key is
  `approval-invocation:v1:<scheme>:<len>:<scope>:<len>:<id>`. Existing semantic
  keys, fingerprints and the legacy replay path are unchanged; a new invocation
  can never match an older semantic receipt.
- `approval_invocation` binds actor, provider actor, binding, action and the
  command fingerprint (`approval-invocation-command:v1:<sha256>`, including the
  reason) to the decision evidence and receipt. Rows are immutable (update
  trigger).
- Receipt before fresh checks: a committed invocation with the same command
  returns its original decision evidence (actor, time, assignment and request
  outcome) before any binding, source or membership state is read, so later
  re-linking or removal cannot turn a replay into "not found". The check is
  repeated after the rollout gate under an advisory lock on the invocation,
  which serializes concurrent deliveries. A different command (including
  another actor presenting the same query) is `invocation_mismatch` (conflict).
  A fresh invocation runs every current check.
- **Pause reaches sent cards.** A fresh invocation rereads
  `approval_presentation_control` under the rollout gate; unless it is still
  `actionable` nothing is decided (`ApprovalInvocationNotAdmittedError`) and the
  card turns into a review notice. Committed invocations keep replaying.
- The actor must still be an approved member (checked before the decision and
  again by the engine's actor resolver).
- Bound decisions use the exact bound assignment and only active-assignment
  authority. Eligible-manager and organization-management authority are never
  invoked from a card (`BoundAssignmentNotCurrentError`); a decided, replaced or
  materially changed request, or a binding for another recipient or tenant,
  decides nothing and the card turns into a review notice.
- Old unbound cards keep their historical-only path (review-only for absences).

The outcome notice reports the request outcome as of the committed operation
("Request approved/rejected"); otherwise the step's own outcome ("Approval
recorded … still awaits further approval", "Rejection recorded … not final
yet"), and for anything else only that a decision was recorded, with the
persisted actor and time.

The webhook still acknowledges Telegram before processing, and
`answerCallbackQuery` carries text only for a committed or verified outcome. A
failed decision logs and claims nothing; message updates are best effort and
never change a committed decision. Guarantees begin at commit: a click lost
after the HTTP acknowledgment but before commit is not recovered (no durable
ingress is claimed); a redelivered or retried query replays.

### Cleanup

`deleteApprovalInTransaction` locks `approval_invocation`, deletes the
lifecycle's invocations before decision evidence and reports them in
`evidence.invocations` (and so in the platform-admin audit). Workflow, binding
and decision FKs cascade. A late redelivery after a purge finds no binding and
recreates nothing.

### Activation

Apply `0081` after `0070`/`0075`, then, as the authorized adoption writer and
under the exclusive rollout lock (same scope as the evidence control):

```sql
begin;
select pg_advisory_xact_lock(hashtextextended(
  'approval-rollout:' || length(:org) || ':' || :org || ':7:absence', 0));
insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
values (:org, 'absence', 'telegram', 'actionable')
on conflict (organization_id, workflow_type, provider) do update set mode = excluded.mode;
commit;
```

No application endpoint changes the mode.

### Activation blockers (#290, unresolved)

1. Apply `0081` through the authorized deployment (it has run only on the
   disposable PostgreSQL 16 database).
2. **Legacy authority.** Bindings exist only for canonical assignments, so
   organizations whose absences are `legacy`, `shadow` or `ready` keep
   review-only cards. A legacy binding representation is not implemented
   (#384).
3. **Routing and delivery (#291).** Implemented by the approval delivery
   owner, which has its own activation blockers; see
   [Approval card delivery](approval-delivery.md). Without its control a stale
   card keeps its buttons; pressing one decides nothing.
4. **Ingress.** No durable acceptance before the webhook acknowledgment.
5. **Escalation race.** Revalidation after a web decision and after a material
   change is verified; a real escalation transfer (#298) between rendering and
   the click is covered by the same active-assignment check but not exercised.
6. Everything in blockers 2–7 of the canonical evidence activation above
   (in-flight classification, old binaries, #306 cleanup ordering, pilot #328).
7. The approval write-boundary scanner cannot read sources on Windows; the new
   raw-SQL delete was checked with the analyzer directly, the builder inserts in
   `evidence/invocation.ts` were not.

### Verification (#290)

PostgreSQL 16 (`lib/telegram/bound-approval.integration.test.ts`, part of
`test:approval-workflow-repository:integration`), driving the real
`requestAbsenceEffect`, `sendApprovalMessageToManager`, `handleTelegramUpdate`,
`approveAbsenceEffect` and `deleteApproval`. Only the session, billing guard,
e-mail/notification fan-out, calendar queue, work-balance marking and the
Telegram HTTP transport (`fetch`) are replaced. 16/16 passing:

- the rendered card (German locale, Berlin zone, logical dates) and its binding
  rows match the recipient's pending assignment and submitted revision;
- approve commits one decision, receipt and invocation (delivery ID, provider
  actor, binding) and retires the card; the same update and a new update with
  the same query replay with no writes and the original time; the same query
  with a different action conflicts; a new query after the decision decides
  nothing;
- reject; an intermediate stage approval reported as recorded, not final;
- a web decision or an in-place material change after rendering decides
  nothing and binds nothing;
- another recipient's press, the same user through another organization's bot,
  a missing query ID and an unrecognizable bot token decide nothing;
- an old unbound card stays review-only; each gate (no control, `review_only`,
  capture off, legacy rollout) yields a review-only card with no binding; the
  Slack constraint;
- an injected invocation insert failure rolls back the whole decision, and the
  same query then decides freshly; three concurrent deliveries of one query
  produce one decision and two replays; privileged cleanup removes and reports
  the invocation and a late redelivery recreates nothing; the update trigger;
- pausing the provider after two cards were sent: the uncommitted card decides
  nothing, the committed press still replays;
- a committed press replays after the absence was unlinked from its workflow,
  and the same query presented by another actor is a conflict;
- an oversized card is sent review-only and issues no binding;
- an actor whose membership is no longer approved decides nothing.

Unit seams: `evidence/invocation.test.ts` (key encoding, identity refusal,
fingerprint), `presentation/bound-card.test.ts` (facts, zones, hour cycles,
on-behalf roles, coverage, essential gaps), `telegram/bound-approval.test.ts`
(callback codec, invocation envelope), `bot-platform/bound-decision-notice.test.ts`
(request versus step outcome wording, replay label, review results),
`maintenance.test.ts`.

## Teams absence cards with reviewed bindings (#293 / T29)

Canonical absence cards on Teams can carry Approve/Reject controls with the
same binding, gates and decision owner as Telegram (#290). Each **recorded
incoming activity** is one invocation. Admission is **inactive for every
organization** (migration `0091_teams_approval_actions.sql` inserts no control
rows).

```text
delivery owner (teams adapter) / existing Teams channel
  prepareApprovalPresentation(provider "teams", fits: ≤ 28 000 bytes)
    all #290 gates hold?  no → review-only notice
  Adaptive Card 1.4: FactSet + Action.Execute (verb z8.approval.approve|reject,
                     data {"b": <binding>}) + Action.OpenUrl (exact item)

POST /api/teams/messages → CloudAdapter (connector JWT) → handleBotActivity
  handleInvoke: tenant from conversation.tenantId → org; aadObjectId → user
    parseTeamsBoundApprovalInvoke                     (teams/bound-approval.ts)
      invoke "adaptiveCard/action", Action.Execute, our verb, trigger "manual",
      data exactly {"b": uuid}
      trigger "automatic" → refresh: nothing decided, nothing written
      our verb in any other shape → review-only
    teamsInvocationEnvelope → attemptBoundBotApproval → decideBoundAbsenceInvocation
  invokeResponse: application/vnd.microsoft.activity.message = outcome title
```

### Supported profile and invocation identity

- Identity is `(organization, teams_adaptive_card_action v1,
  teams-bot:<app id>:tenant:<tenant id>:conversation:<conversation id>,
  activity.id)`. The activity ID is kept exactly as sent. There is no separate
  transport delivery ID (`delivery_id` is null).
- The envelope is refused, and the press is review-only, unless every part is
  established: `channelId` `msteams`; `recipient.id` is `28:<MICROSOFT_APP_ID>`
  (the audience the connector JWT was validated for); a tenant GUID, with
  `conversation.tenantId` and `channelData.tenant.id` agreeing when both are
  present; a personal conversation with an ID; a non-empty activity ID; and
  the sender's `aadObjectId` (provider actor). The resolved user's mapping
  must belong to the tenant's organization.
- `replyToId` (the card message) and `value.action.id` (the copied card
  action) identify the card, never the invocation, and are never substituted
  for a missing activity ID.
- Same activity with the same command replays the original evidence; with a
  different command it conflicts; a new activity gets fresh checks and never
  matches an older semantic receipt. **Limit (#261):** this deduplicates the
  same recorded activity. Microsoft does not promise that every client or
  service retry keeps the activity ID, nor that every physical click creates a
  new activity; a retry with a new ID is a fresh invocation and is decided only
  if the binding is still current.
- Pause reaches sent cards: a fresh invocation rereads
  `approval_presentation_control` for `teams`.
- Old unbound cards (`value.action` + `value.approvalId`) keep their
  historical-result-only path; the value is now validated instead of cast.
  Old `messageBack` cards are not approval invocations.

### Acknowledgment and card writers

The webhook awaits the decision before answering the invoke (Teams may retry
after 15 seconds; a retry of the same activity replays). The response carries
the outcome title ("Request approved", "Approval recorded", "Review
required"); if the decision failed with an unknown outcome it is an
`application/vnd.microsoft.error` saying so, and nothing is claimed. It is not
evidence of commitment.

- Card sent by the delivery owner: a decided card (assignment or request no
  longer pending) is left to the owner, which refreshes every message of the
  lifecycle. A still-pending card whose press decided nothing is updated in
  the turn into a review notice and marked without controls.
- Card sent by the existing Teams channel (no delivery control): tracked in
  `teams_approval_card` and updated in place with the outcome notice.

### Activation

Apply `0091` after `0090`, then per organization, as the authorized adoption
writer under the rollout lock (same statement as #290 with provider
`teams`):

```sql
insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
values (:org, 'absence', 'teams', 'actionable')
on conflict (organization_id, workflow_type, provider) do update set mode = excluded.mode;
```

### Activation blockers (#293, unresolved)

1. Apply `0091` through the authorized deployment (it has run only on the
   disposable PostgreSQL 16 database).
2. **Live Teams profile.** The Universal Action shape, the presence of
   `activity.id` on `adaptiveCard/action` invokes and the invoke response were
   built from Microsoft's documentation and verified with constructed
   activities. A real tenant must confirm them before admission; until then
   any deviation is review-only, never a decision.
3. **Retry identity.** No first-party statement that retries keep the activity
   ID (#261 §4). Accepted as scoped recorded-activity deduplication only.
4. **Connector authentication** runs in the route (`CloudAdapter.process`) and
   was not exercised by the suite.
5. **Markdown rendering.** Request facts are escaped for inline emphasis,
   code and link syntax (backslash, backtick, `*`, `_`, `[`, `]`, `~`) only. That Teams hides those escape
   backslashes in `FactSet` and `TextBlock` text is unverified in a real
   client.
6. **Webhook versus owner writes.** The webhook checks that a delivered card
   is still pending, then turns it into a review notice. A decision committed
   in between can let the owner refresh the card first and the webhook
   overwrite it with "Review required" (no controls either way; the same
   window exists for Telegram).
7. Legacy authority (#384), escalation replacement delivery (#300), ingress
   (no durable acceptance before the invoke is answered), and everything in
   the #290 and #291 blockers.

### Verification (#293)

PostgreSQL 16 (`lib/teams/bound-approval.integration.test.ts`, part of
`test:approval-workflow-repository:integration`), driving the real
`requestAbsenceEffect`, `processApprovalDeliveries`, `handleBotActivity`,
`approveAbsenceEffect`, `saveConversationReference`, `sendTeamsNotification`,
`sendApprovalCardToManager` and `deleteApproval`. Replaced: session, billing
guard, e-mail/notification fan-out, calendar queue, work-balance marking, the
post-commit fast path, the bot credentials and the connector transport
(`sendActivityWithOutcome`, `updateActivityWithOutcome`,
`sendProactiveMessage`). 13/13 passing:

- one bound card with full identity (bot/tenant scope, conversation, activity,
  binding); no private note; a rerun sends nothing;
- approve commits one decision and one invocation with the scoped identity and
  the invocation-derived receipt key; the response says "Request approved";
  the webhook leaves the card to the owner, which retires it; the same
  activity replays with no writes; the same activity with Reject conflicts; a
  new activity after the decision decides nothing;
- an automatic refresh decides and writes nothing;
- a missing activity ID, conflicting tenant fields, another bot and another
  channel decide nothing; the pending card becomes a review notice;
- a web decision, an in-place material change after rendering, and a departed
  member decide nothing;
- an old unbound invoke stays historical-only;
- a missing conversation waits for repair and is delivered after the
  recipient messages the bot; 502 is an ambiguous retry after 1 minute, 403
  `ConversationBlockedByUser` waits for repair, a send without a message ID is
  ambiguous and untracked; a failed refresh leaves the decision approved and
  retries;
- a card that went stale in flight is retired; an oversized card is sent
  review-only without a binding;
- the existing Teams channel and the old sender used by legacy escalation
  stay silent under the owner, and the channel still sends without it; a bound card from that path is decided and updated in place;
- privileged cleanup reports the invocation and message; a late retry
  recreates nothing.

Unit seams: `teams/bound-approval.test.ts` (profile, refresh, envelope scope
and refusals), `teams/delivery-outcome.test.ts` (connector failure
classification).

## Manual time submissions and policy clock-outs (#302 / T38)

Manual time submissions and policy clock-outs keep immutable approval evidence
in the same tables as absences and expenses. Capture follows
`approval_evidence_control` per organization and kind (`manual_time_submission`,
`policy_clock_out`). No control row exists anywhere, so capture is
**inactive for every organization**. No migration is needed: the evidence tables
and the enum values already exist.

Code: `lib/approvals/evidence/work-period-facts.ts` (facts, fingerprint,
comparison), `work-period-evidence.ts` (capture, decision checks and records,
result segments, 409 translation), rows in `store.ts`, whole-history cleanup in
`maintenance.ts` (`deleteWorkPeriodApprovalEvidence`).

### Who writes what, and when

| Evidence | Written by | When |
| --- | --- | --- |
| Submitted revision (`authority` = the deciding authority) | `executeOrdinaryWorkPeriodSubmissionInTransaction`, for every caller: web clock-out through `closeActiveWork` (#274), the unadopted web/mobile closure (#272) and `createManualTimeEntry` | Same transaction. Facts are read from the locked period **before** routing or auto-completion can change it. The row is written once routing has created the lifecycle |
| Submission activation outcome | Same owner | When routing auto-completes (requester is approver): `system` actor, persisted `approval_request.approved_at` (legacy) or `approval_workflow.completed_at` (canonical) |
| Decision evidence (canonical) | Work-period adapter hooks in the transition engine (`preflightDecisionEvidence` / `recordDecisionEvidence`, wired by `createProductionApprovalWorkflowRuntime`) | Same transaction as the transition, terminal finalization and command receipt; executed decisions only |
| Decision evidence (legacy, doubles as the legacy operation receipt) | Legacy branch of `executeOrdinaryWorkPeriodDecisionInTransaction` | Same transaction, after the legacy mutation (and any shadow mirror) |

`closeActiveWork` receipts (#274) also name the submitted revision in
`result.approval.submittedRevisionId` (`null` while capture is inactive). The
receipt records the original participation; the current approval state is a
separate read.

### Submitted facts

- Work period, canonical record, subject employee (owner), requester and the
  separately evidenced submitting human (`submitterUserId`, defaulting to the
  requester's user; the manual action passes the session user).
- The interval: for each endpoint, the entry ID, exact UTC instant, the event's
  own captured offset, zone and zone source. Endpoints may carry different
  offsets.
- The **stored submitted minutes** as persisted, never recomputed, and the UTC
  elapsed seconds between the endpoints, kept apart.
- Manual: the surcharge snapshot the submission captured. There is no before
  state, and none is recorded.
- Policy clock-out: the captured break-policy snapshot and surcharge snapshot,
  plus `breakAdjustment: "may_apply" | "not_applicable"`, derived only from the
  snapshot. No deduction is predicted; the number exists only as result evidence.
- Attribution (project, category, location) is descriptive and not material.
- Labels: subject, requester and submitter names at submission time. The
  submission reason (free text) is never copied.
- `submitted_at` is the persisted creation of the approval request routing
  created (legacy) or the workflow's `submitted_at` (canonical).
- Material fingerprint `work_period:v1:<sha256>` over identity, interval,
  stored minutes and policy inputs.

Unverifiable evidence (missing or foreign endpoint entry, an endpoint that is
not the period boundary, an open or deleted period, equal or reversed
endpoints, a missing break snapshot for a policy clock-out, a requester who is
not the owner) throws `evidence_incomplete` and rolls the whole submission back:
for web clock-out, the closure, append position, receipt and approval rows.

### Decision evidence and results

The decision row records the action, the approver's own outcome, the request
outcome as of the operation (an intermediate chain approval stays `pending`),
the persisted decision time, the actor and its label. `result` holds:

- `workPeriodStatus`, read from the period as the operation leaves it;
- legacy: `legacyRequestStatus` and `decidedAtSource`
  (`approval_request.approved_at`, `approval_request.updated_at` for a
  rejection, or `approval_chain_stage_instance.decided_at`), and
  `actorAuthority`. A chain stage persists its decider, which must equal the
  actor (`decided_stage`). A single-stage request keeps its assigned approver
  even when an eligible manager or organization-wide approver decides it, so
  its row cannot name the decider; the evidence records whether the
  authorized actor was the assigned approver (`assigned_approver`) or not
  (`other_authorized_approver`) instead of pretending the row confirmed it;
- `terminal`, when this operation finalized the period: `status`, the committed
  `adjustment` (`none`, `break_not_required`, or `break_enforced` with the
  inserted minutes) and **every resulting segment**, each with its period,
  canonical record, endpoints and captures, its own stored minutes and UTC
  elapsed seconds, read from the result graph in the same transaction; plus the
  follow-ups the decision owner runs after commit (work-balance date, surcharge
  recalculation periods, stale surcharge periods).

The finalizer reports what it did (`WorkPeriodApprovalResult.outcome`, passed
to the engine as `finalization.workOutcome`); the recorder never reconstructs
the result from the requested action. The submitted revision stays unchanged
when a break split moves the original period's end.

The owners' receipt keys embed the decision reason. Evidence stores only
`receipt-key:sha256:<digest of the exact key>` (`workPeriodReceiptKeyDigest`),
so reason text stays in workflow events and legacy rows.

### Replay, holds and rollback

- **Receipt before fresh checks.** Canonical: the engine's command receipt
  replays before any evidence read. Legacy: the owner's established state-based
  replay matching runs first and returns without evidence reads or writes.
- **Fresh checks** run only after that. Once a lifecycle has a submitted
  revision it is always enforced: the live period, its endpoint entries, stored
  minutes and canonical record must equal the revision, otherwise
  `material_change`. While capture is active, a lifecycle without a revision is
  held (`evidence_required`). Supplied reviewed bindings are refused
  (`binding_mismatch`); time-kind bindings are #325.
- Holds surface as `ConflictError` with `conflictType: "approval_evidence"` on
  the inbox (`decideTimeCorrectionWithStableTargetEffect` delegation), the
  admin/bot path (`decideOrdinaryWorkPeriodWithStableTargetEffect`) and the API
  routes. Integrity contradictions (`invariant`) stay errors.
- An evidence write failure rolls back the decision or submission completely.
- A replayed submission (same submission identity, or a receipt replay in
  `closeActiveWork`) never recaptures.

### Cleanup participation

- Privileged `deleteApproval` removes exactly one lifecycle's revisions and
  decision evidence through its verified workflow or legacy request links, as
  for other kinds, and reports them in the audit.
- Whole-history paths remove time-kind evidence with the history it describes,
  before the history and employees are deleted: `clearOrganizationTimeData`
  and `deleteNonAdminEmployeesData` (every lifecycle naming one of their
  employees as subject, requester, submitter or deciding actor), organization
  cleanup (the whole organization). Only organization cleanup runs in one
  transaction; the two demo paths have never been transactional, so a failure
  part-way through them can leave history without its evidence. Other kinds
  are untouched (#306).
- Organization deletion also cascades through the organization FK.

### Activation

As the authorized adoption writer, under the exclusive rollout lock of the kind
(`:16:policy_clock_out` or `:22:manual_time_submission`):

```sql
begin;
select pg_advisory_xact_lock(hashtextextended(
  'approval-rollout:' || length(:org) || ':' || :org || ':16:policy_clock_out', 0));
insert into approval_evidence_control (organization_id, workflow_type, mode)
values (:org, 'policy_clock_out', 'capture')
on conflict (organization_id, workflow_type) do update set mode = excluded.mode;
commit;
```

No application endpoint changes the mode.

### Activation blockers (#302, unresolved)

1. **In-flight classification.** Enabling capture holds every pending manual or
   policy clock-out request submitted before capture (`evidence_required`).
   Drain them or record provenance-bearing reconstructed revisions through a
   separately authorized step (not implemented).
2. **Held requests have no resolution path or durable attention.** A materially
   changed pending entry is refused for approve and reject; ordinary users have
   no cancel/resubmit path for manual or policy clock-out approvals. It stays
   pending until privileged cleanup or a separately agreed repair.
3. **Live clock-out approval stays dormant** (`checkClockOutNeedsApproval` is
   production-false, #361). This slice changes no approval policy; the policy
   clock-out path is verified only with that decision forced.
4. Manual submissions still use the pre-#308 action (caller-side zone
   interpretation, overlap trimming, age check). The evidence records what that
   action stored; the strict manual command is #308. That action's own record
   of the submission (the canonical record's `computationMetadata`) is written
   before routing and does not name the submitted revision; the revision is
   reachable through the approval request it references. A manual operation
   receipt that names it belongs with #308.
5. Terminal split lineage and the review exemption are #303; this slice
   records the committed segments but does not change how splits are made
   (including the second segment's minutes, derived by subtraction).
6. Presentation of these facts in the inbox and cards is #325; bindings for
   time kinds do not exist yet.
7. Not verified on PostgreSQL: mobile and offline clock-out callers (same
   owner), bots deciding time approvals, multi-stage chains, `shadow`/`ready`
   modes, concurrent decision races, and old binaries (pre-deployment binaries
   submit and decide without evidence).
8. Whole-organization cleanup ordering for other kinds (#306), then the pilot
   (#329/#330).

### Verification (#302)

PostgreSQL 16 (`time-tracking/actions/clocking.approval-evidence.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
`clockIn`/`clockOut` (adopted through `closeActiveWork`), `createManualTimeEntry`,
inbox `approveApprovalInboxItem`/`rejectApprovalInboxItem`, `deleteApproval`
and `clearOrganizationTimeData`. Only session, billing, notification delivery
and Next cache are replaced; clock-out and manual approval requirements are
forced. 10/10 passing:

- policy clock-out capture: legacy revision linked to the routed request,
  endpoint captures, stored 61 minutes versus 3640 elapsed seconds, break
  disclosure from the snapshot, labels, `submitted_at` from the request; the
  receipt names the revision; exact retry writes nothing;
- capture inactive writes nothing and the receipt says so;
- unroutable approval and an injected revision insert failure leave every row
  unchanged;
- approval with a break split: decision time from `approved_at`, actor, and
  both resulting segments (360 and 31 stored minutes, captures, entry IDs),
  follow-ups; the submitted revision unchanged; `UPDATE` rejected; replay
  writes nothing;
- rejection time from `updated_at`, no reason text in evidence;
- `evidence_required` and `material_change` holds leave every row unchanged;
  an injected decision-evidence failure rolls the decision back, which then
  commits freshly;
- canonical lifecycle: revision on the workflow, decision with stage,
  assignment, events and assignment resolution time;
- manual submission: browser-zone captures (+120), 510 stored minutes, no
  before state, no reason text; exact retry writes nothing; approval evidence;
- privileged cleanup removes exactly one lifecycle; time-data cleanup removes
  the rest.
- the whole-history helper removes a lifecycle whose deciding approver is
  deleted while its subject stays. (`deleteNonAdminEmployeesData` itself still
  cannot delete such an approver: the pre-existing `approval_request.approver_id`
  FK blocks it, unrelated to evidence.)

Unit seams: `evidence/work-period-facts.test.ts`,
`domain-adapters/work-period.adapter.test.ts` (hooks, work outcome),
`server/work-period-approvals.test.ts` (legacy prepare → mutation → record
ordering, hold before mutation, failure propagation),
`policy-clock-out-terminal-break.test.ts` (created period reported),
`jobs/organization-cleanup.test.ts`.
