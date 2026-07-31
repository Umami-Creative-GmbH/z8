# Approval Migration Recovery Design

## Problem

Production recorded `0059_payroll_blocker_dismissal` before the approval workflow branch merged. The later merge placed these migrations before `0059` in the journal:

- `0055_approval_workflow_expand` at `1785232090757`
- `0056_approval_workflow_cycle_identity` at `1785232118219`

Production had already recorded `0059` at `1785493929039`. Drizzle applies only journal entries whose `when` value is greater than the latest `drizzle.__drizzle_migrations.created_at` value. It therefore skipped both approval migrations without error. The deployed application then queried approval columns such as `work_period.approval_workflow_id`, which did not exist.

The repository also contains older non-increasing journal entries at `0021` and `0027`, but later idempotent recovery migrations already cover those historical skips. They are not the cause of this incident.

## Constraints

- Do not rewrite production migration records or assume direct database access.
- Do not renumber or replay the existing non-idempotent approval migrations.
- Preserve databases where `0055` and `0056` already ran successfully.
- Repair databases that reached `0059` without either approval migration.
- Keep the recovery safe to retry after a failed deployment.
- Add the recovery after every existing journal timestamp.

## Recovery Migration

Add `0060_approval_workflow_recovery.sql` and a matching journal entry whose `when` value is greater than `1785493929039`.

Preserve the published timestamps for the historical `0021` and `0027` inversions. Changing those migration identities could make old, non-idempotent SQL replay on a database paused at one of those historical boundaries. Their later recovery migrations (`0051_sick_detail_recovery` and `0029_employee_work_balance_recovery`) remain authoritative for databases that skipped them.

The migration uses `approval_workflow` as the atomic anchor for `0055`. PostgreSQL migrations are transactional, so the supported states are:

1. The anchor is absent and the complete approval expansion must be installed.
2. The anchor is present because the complete approval expansion already committed.

When the anchor is absent, the recovery executes the complete schema work represented by `0055`, including approval enums, canonical tables, source-link columns, indexes, checks, unique constraints, and organization-scoped foreign keys. It must also retain the existing idempotent daily-digest recovery that precedes approval schema creation in `0055`.

When the anchor is present, the recovery does not recreate approval enums, tables, columns, or constraints and does not mutate approval data.

After the expansion check, the migration independently reconciles `approvalWorkflow_org_source_pending_idx` to the `0056` definition. This step drops only that named index when its existing definition differs, then creates the required unique partial index over:

```text
organization_id, workflow_type, source_type, source_id
```

with predicate `status = 'pending'`.

This independent index reconciliation handles a database where `0055` committed but `0056` did not.

## Migration Guardrails

Extend migration tests with repository-wide invariants:

- Every journal inversion must match the explicit historical allowlist for `0021` or `0027`; no new inversion is permitted.
- Every non-exempt journal tag must have one matching SQL file, and every non-exempt SQL file must have one matching journal tag.
- Duplicate numeric SQL prefixes are rejected unless explicitly documented as a historical orphan with a later recovery.
- A newly added migration cannot have a `when` value below the maximum preceding value.
- `0060` must be registered after `0059` with a timestamp greater than every preceding migration.

The historical `0051_daily_digest_delivery.sql` orphan remains explicitly documented because `0055` and the new recovery cover it. The test should not mistake that known file for a new deployable journal entry.

## Verification

Verify these database histories:

1. **Production incident state:** migrations through `0054` plus `0057`-`0059`, with approval schema absent. Applying current migrations creates the complete approval schema and records `0060`.
2. **Already migrated state:** migrations through `0059`, including `0055` and `0056`. Applying `0060` succeeds without recreating objects or changing data.
3. **Fresh state:** applying the complete journal to an empty PostgreSQL database produces the current schema.
4. **Retry state:** applying the migrator again performs no schema changes and succeeds.

Static contract tests must verify that the recovery contains the same approval tables, columns, indexes, constraints, and enum values as the current schema snapshot. A real PostgreSQL migration test or disposable local database run must verify transactional execution for the incident and already-migrated states.

## Deployment

Ship the migration image before or atomically with the webapp image. The migration job remains protected by the existing advisory lock. The webapp should not be considered healthy until the migration job succeeds.

No manual insertion into `drizzle.__drizzle_migrations` is required. After `0060` succeeds, normal Drizzle ordering resumes because subsequent migrations must use a greater `when` value.
