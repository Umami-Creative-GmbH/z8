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
| **Reviewed binding** (`approval_review_binding`) | `issueReviewBinding` (no caller yet; for #289/#290) | Opaque handle for one recipient, assignment and submitted revision |

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

Bot cards are unchanged: they stay review-only (#270). Admitting actionable
evidence-backed cards belongs to #290–#294.

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
submitted before capture belong to #296.

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
   submitted before capture have no revision and are not held here (#296).
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
