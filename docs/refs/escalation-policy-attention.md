# Shared escalation policy and attention — #297 / T33

## What this slice adds

Approval managers can see and edit one organization escalation policy, review how
it was migrated from the per-channel settings, and work durable administrative
attention with an audited disposition. Nothing here transfers assignment
authority, schedules work or changes `approval_escalation_control`; legacy channel
automation keeps running until the separately authorized cutover.

Module: `apps/webapp/src/lib/approvals/escalation/`

| File | Responsibility |
| --- | --- |
| `policy.ts` | Pure settings-migration derivation and channel-preference comparison |
| `deadline.ts` | Pure Temporal elapsed-hour deadline against the current policy |
| `attention.ts` | Pure incident identity, recheck classification, inbox link |
| `policy-store.ts` | Idempotent policy preparation, revisioned edits, conflict review |
| `attention-store.ts` | Raise/observe, resolve, audited disposition, recheck, admin alerts |
| `management-overview.ts` | Organization-scoped read model for the settings page |

UI: `/settings/approval-escalation` (settings → Administration → Approval
Escalation). The page and every server action require `manage` on `Approval` for
the active organization. Holding an approval assignment or being an eligible
manager is not sufficient.

## Settings migration

`prepareEscalationPolicy(organizationId)` runs once per organization and never
rewrites an existing policy. The management page calls it on first load; the
cutover preparation must call it for every organization it activates.

| Integration state | Effect |
| --- | --- |
| `setup_status = 'active'` and `enable_escalations = true` | Counts toward enablement; valid timeouts (1–720 h) compete for the window |
| At least one such source | Policy **enabled**, window = shortest valid timeout |
| No such source | Policy **disabled**, window = 24 h placeholder |
| Any channel's `enable_escalations` | Kept as that channel's escalation **delivery preference**; disabled channels never start sending |

All four integration tables are read (Teams may have several tenants per
organization). The migration records, per source, channel, row id, display
name, setup status, toggle, timeout and whether it contributed, plus these
conflicts for administrator review:

- `differing_timeouts` — contributing sources disagreed; the shortest won.
- `invalid_timeout` — an enabled active source had a timeout outside 1–720 h.
- `disabled_active_source` — policy enabled while an active channel had escalations off.
- `inactive_source_enabled` — a non-active channel had escalations on and was ignored.

Conflicts set `conflict_review_status = 'pending'` until a manager marks them
reviewed (audited). After migration, deadlines belong to the organization policy;
channel `escalation_timeout_hours` values are shown only for comparison.

## Policy edits and deadlines

Edits are optimistic on the current revision, write an immutable
`approval_escalation_policy_revision` row and an `audit_log` entry
(`approval_escalation.policy_updated`). `evaluateEscalationDeadline` adds the
**current** window to the assignment's evidenced actionable instant in absolute
hours, so edits move pending deadlines without restarting any clock, and
eligibility starts exactly at the deadline. Callers record the evaluated
`policyRevision` with committed outcomes.

## Administrative attention

`approval_escalation_attention` holds one **open** incident per organization and
deterministic dedupe key (partial unique index). Keys:

| Reason | Scope |
| --- | --- |
| `no_eligible_backup`, `replacement_overdue`, `unsupported_route`, `delivery_unavailable` | assignment (canonical id, or legacy request + approver) |
| `ambiguous_history` | lineage root when known, else assignment |
| `delivery_exhausted` | assignment + channel |

- `raiseEscalationAttention(executor, input)` takes the caller's transaction and
  returns `raised`/`observed`; it never throws to signal a hold, so the hold commits.
- Recurrence after closure opens a new incident with its own history.
- `recheckEscalationAttention` closes incidents as `resolved` only when the
  approval is no longer pending, or (except lineage-wide history ambiguity) the
  concerned assignment is no longer current. Missing records are not recovery.
- `dispatchEscalationAttentionAlerts` notifies approved owners/admins through
  `createNotification` (type `approval_escalation_attention`, preference-aware,
  idempotency key per incident and recipient). `admin_alerted_at` is bookkeeping
  only; alerts never close incidents.
- `disposeEscalationAttention` requires a note, closes as `disposed`, and writes an
  attention event plus `audit_log` (`approval_escalation.attention_disposed`) in one
  transaction. It does not change authority or restore an automatic allowance.
- Every change appends to `approval_escalation_attention_event`.

The page's **Recheck** button runs a bounded recheck and alert dispatch for the
active organization. No scheduler runs either operation yet; the escalation
processors (#298–#300) raise and resolve reason-specific conditions.

## Representation and cleanup

Migration `0069_escalation_policy_attention.sql` adds the four tables and the
`approval_escalation_attention` notification type. Every table cascades from its
organization (revisions and events through composite FKs), so whole-organization
deletion removes the lifecycle. Privileged approval deletion removes the
incidents of the purged lifecycle, which name its workflow, assignments or
legacy requests by value (#306). User FKs (`updated_by`, `changed_by`,
`disposed_by`, `actor_user_id`) follow the existing audit convention of
`ON DELETE NO ACTION`. CHECK constraints enforce closure/disposition/actor
consistency.

## Activation blockers

- Canonical absence transfers (#298, [escalation-transfer.md](escalation-transfer.md))
  raise and resolve transfer conditions once ownership moves; legacy absences,
  delivery and other kinds (#299, #300, #326) are not implemented yet.
- Policy preparation is not yet invoked for organizations that never open the
  page; cutover preparation must call it.
- PostgreSQL migration application, partial-index upsert behavior, CHECK
  constraints, cascades and concurrent preparation/disposition races are
  unverified without database access.
- Canonical scenarios through the real scheduled caller boundary remain open
  (#251/#255 verification lists); pure-function tests do not prove runtime
  guarantees.

## Verification checkpoint — 2026-09-24

Authorized scope: typecheck and unit tests only; no database access.

- `policy.test.ts`, `deadline.test.ts`, `attention.test.ts`: 25 tests pass
  (migration combinations, no enabled source, invalid/differing timeouts,
  delivery preference preservation, exact deadline, DST-independent elapsed
  hours, policy edits without clock reset, dedupe keys, recheck classification).
- Adjacent suites pass: settings config, notification settings/types, route
  contract (count updated for the new page), db index/schema, legacy fencing.
- `tsc` passes for `tsconfig.typecheck.json` except the pre-existing missing
  generated `@/data/licenses.json` (build artifact, not generated here);
  workflow-contracts and smoke projects pass.
- Environmental failures on this Windows checkout, unrelated to this slice:
  `drizzle-migrations.test.ts` CRLF substring checks on 0054/0055, and
  `approval-write-boundary.test.ts`, whose native analysis cannot retrieve
  247 source files (including untouched ones) and hits symlink `EPERM`.
  The new modules write only to the new escalation tables and `audit_log`,
  which are outside the protected write inventory.
- Later that day, with authorization: `0069` applied alone (8 statements, one
  transaction) to the local Development database, then a browser check on the
  dev server as an organization owner (German locale):
  - Migration with no connected channels → disabled, 24 h, revision 1 with
    migration provenance.
  - Invalid window rejected client-side; enable + 12 h + reason saved as
    revision 2 with history and `approval_escalation.policy_updated` audit row.
  - A seeded test incident (no real approval) deduplicated on a second raise via
    the partial unique index (`observation_count = 2`, same id); it rendered with
    reason, approver fallback, policy revision and history.
  - Close without a note was rejected; close with a note set `disposed`, events
    `raised → disposed`, and wrote `approval_escalation.attention_disposed`.
    CHECK constraints accepted every transition.
- Still not executed: **Recheck** (it dispatches real admin alerts), phone-width
  layout, build, concurrent races, cascade deletion.

Binding contracts: [#297](https://github.com/Umami-Creative-GmbH/z8/issues/297),
[#251](https://github.com/Umami-Creative-GmbH/z8/issues/251#issuecomment-5653026359),
[#255](https://github.com/Umami-Creative-GmbH/z8/issues/255#issuecomment-5653995791),
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
and [parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264).
