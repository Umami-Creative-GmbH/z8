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

1. Apply the migration through the normal authorized deployment; verify it on a
   real PostgreSQL instance (FKs, trigger, `ON DELETE CASCADE`, unique indexes).
2. **In-flight classification.** Enabling capture holds every pending canonical
   absence without a revision. Drain them first, or record provenance-bearing
   reconstructed revisions through a separately authorized preparation step (not
   implemented here).
3. Verify through the real caller boundaries with PostgreSQL: web and mobile
   submission, inbox single and bulk decisions, multi-stage intermediate approval,
   parallel races between decision and `sick-vacation-override`, replay after a
   material change, rollback at each write, tenant isolation, and privileged
   cleanup plus late-capture failure.
4. Confirm no old binaries decide canonical absences without the evidence hooks
   (pre-deployment binaries bypass them).
5. Whole-organization cleanup ordering (see above) must be reconciled and
   verified with PostgreSQL before production capture (#306).
6. Legacy-authoritative absences are not covered (#288). Bots stay review-only;
   exact-item navigation (#289) and binding issuance for cards (#290) remain.
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
