# Legacy escalation execution fencing — #271 / T07

## Capability and ownership

The retained registry processors for `cron:teams-escalation`,
`cron:telegram-escalation`, `cron:discord-escalation` and
`cron:slack-escalation` call the same provider job handlers for scheduled,
already-queued and manually submitted work. Each handler reads
`approval_escalation_control` freshly for each escalation-enabled organization,
before discovering or processing approvals. Direct handler invocation also
passes through this check.

The escalation module owns this organization-wide control. It is distinct from
per-kind `approval_workflow_rollout` authority and per-channel notification
configuration:

| Stored control | Legacy execution |
| --- | --- |
| No row | Existing legacy behavior (additive rollout default) |
| `owner = legacy`, `automation_paused = false` | Existing legacy behavior |
| `owner = escalation` | Suppressed, including while the new owner is paused |
| `owner = legacy`, `automation_paused = true` | Suppressed |
| Unknown owner | Suppressed |
| Read/schema/database failure | No legacy execution for that organization; job reports failure |

Results expose `suppressedOrganizations` with organization IDs and explicit
`ownership_moved` / `automation_paused` reasons through existing cron execution
tracking. Suppression is a successful no-op, distinct from infrastructure failure.
The existing processed count remains the count of configured bots/tenants visited.

This read only admits fresh legacy work. It does not delete, restore or rewrite
assignments, receipts, escalation history, or delivery recovery. The new transfer
and delivery operations are not activated here. No ownership mutation endpoint,
policy migration, historical repair or fallback to legacy after adoption is added.
The authorized exclusive adoption writer must own future control changes.

## Representation and cleanup

Migration `0068_legacy_escalation_fencing.sql` adds the control table with one row
per organization and an organization FK with `ON DELETE CASCADE`. It inserts no
control rows and activates no organizations. Apply the migration through the
normal authorized deployment before running gate-aware workers; missing schema
is an error, not permission to run legacy work.

Whole-organization deletion removes the control through the FK. There is no new
receipt, delivery, history or attention lifecycle in this slice. Actual PostgreSQL
migration and cascade behavior remain unverified pending authorized database access.

## Explicit scheduler retirement

`RETIRE_LEGACY_ESCALATION_SCHEDULERS=true` is a **system-level scheduler lifecycle
setting**, not tenant policy or execution authorization. It defaults to inactive.
Only enable it after all affected organizations can safely stop legacy scheduling.

- Worker setup explicitly removes all four `cron-cron:<provider>-escalation`
  BullMQ schedulers, even when `ENABLE_CRON_JOBS=false`.
- Every later reconciliation, including platform-admin schedule changes, removes
  rather than upserts those schedulers while the setting remains enabled.
- An already absent scheduler is successful retirement. Redis errors are reported;
  repeated reconciliation recovers partial removal. The admin action reports a
  retirement warning instead of claiming that its requested schedule was installed.
- Set the retirement flag consistently on every worker and webapp process that can
  reconcile schedules. A process with old code or a different setting can recreate
  schedulers. A one-time removal is not persistent fleet retirement evidence.
- `retireLegacyEscalationSchedulers(queue)` is the explicit retirement operation;
  it respects the setting and uses the existing queue/reconciliation owner.
- Keep the old job-name registrations and their guarded handlers. Scheduler removal
  does not prove queued/manual consumption stopped, and does not drain active jobs.
  `ENABLE_CRON_JOBS=false` alone only disables creation of schedules.

No scheduler removal or deployment was executed during implementation.

## Activation blockers and required operational evidence

This ticket installs execution-time admission capability, not deployed old-worker
control or an atomic ownership cutover protocol. The check is a fresh read, **not
a lock spanning legacy execution**. Work admitted before a pause/ownership change
can still be in flight. Do not use a passing admission test to claim a cutover race
is solved.

Before activation, record evidence for all of the following:

1. Deploy gate-aware binaries everywhere. Identify and verify drain of pre-gate
   binaries and their active jobs; new source cannot fence already running old code.
2. Integrate the parent's outer-transaction/exclusive organization adoption protocol
   with all participating writers and prove its concrete lock ordering in PostgreSQL.
   Until that protocol is installed and verified, drain **all** active legacy jobs
   before changing ownership; that includes gate-aware jobs admitted earlier.
3. Satisfy policy/provenance migration, assignment/history classification, holds,
   real replacement decision/inbox and provider delivery/recovery readiness for the
   intended organization/kind/authority scope. This table does not establish them.
4. Through real queued/manual dispatch and PostgreSQL, prove suppression after
   ownership changes and pauses, tenant isolation, preservation of existing
   assignments/receipts/recovery and cascade cleanup. Exercise active-worker races.
5. Through actual BullMQ/Redis, verify removal, restart/reconciliation behavior,
   surviving queued/manual names, partial-removal retry and fleet drain. Confirm
   that every schedule-writing process has the retirement configuration.
6. Exclusively switch the authorized scope, run the limited organization pilot,
   observe recovery-preserving pause/rollback, then authorize expansion.

Database/Redis access, deployment inventory, exclusive cutover integration and pilot
evidence remain outstanding. Source review and mocked boundary tests are not runtime
evidence for these obligations. Keep #271's runtime acceptance open while blocked.

## Local verification seams

`legacy-escalation-fencing.test.ts` invokes all four real registry processors and
real handler/gate code with database and provider boundaries replaced. It covers
organization-scoped control reads, moved/paused suppression without side effects,
fail-closed reads and fresh ownership on a subsequent run. It does not emulate
BullMQ consumption, real persistence or concurrency.

`reconciliation.test.ts` exercises the real reconciliation and retirement operations
with a queue boundary fake, including all four names, unrelated scheduling,
already-absent schedulers and partial Redis failure/retry. Existing worker-import,
worker-dispatch and admin-action suites supply adjacent regression coverage.

### Session checkpoint — 2026-09-14

Before the user stopped verification, `pnpm --filter webapp typecheck` passed
(before the final admin-warning addition). The focused command covering the five
files above passed **67 tests** after that addition. These are local checks only,
with database/provider/queue boundaries replaced as described above.

The user subsequently confirmed that PostgreSQL is unavailable for this project
and requested no further verification. The full suite, final typecheck and
two-axis code review were not completed. No PostgreSQL/Redis integration,
migration application, build, repair, deployment or activation was executed.
Resume verification only with renewed permission and the necessary access.

Binding contracts: [#271](https://github.com/Umami-Creative-GmbH/z8/issues/271),
[#255](https://github.com/Umami-Creative-GmbH/z8/issues/255#issuecomment-5653995791),
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145),
and [parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264).
