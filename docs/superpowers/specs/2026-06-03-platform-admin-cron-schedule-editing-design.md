# Platform Admin Cron Schedule Editing Design

## Context

`/platform-admin/worker-queue` already shows queue counts, reliability data, BullMQ repeatable cron jobs, job metrics, and recent executions. Cron schedules are currently static definitions in `apps/webapp/src/lib/cron/registry.ts`, and the worker registers those schedules on startup through BullMQ repeatable jobs.

Platform administrators need to change cron job schedules from the worker queue page without editing code or redeploying. Schedule changes should be durable, auditable, and should take effect immediately when BullMQ is reachable. Worker startup should also reconcile saved changes so temporary BullMQ failures self-heal.

## Goals

- Allow platform admins to edit visible cron job schedules inside `/platform-admin/worker-queue`.
- Use preset-only schedule choices in the first version.
- Support resetting an edited job back to its code-defined default schedule.
- Persist schedule overrides in Postgres so changes survive worker restarts and Redis resets.
- Attempt immediate BullMQ repeatable-job reconciliation after each edit or reset.
- Reconcile effective schedules again during worker startup.
- Audit platform-admin schedule changes with old schedule, new schedule, admin user, and immediate reconciliation result.
- Add extra confirmation copy for high-risk jobs.

## Non-Goals

- No arbitrary cron-expression editor in the first version.
- No tenant-specific schedule settings.
- No per-organization cron schedules.
- No separate permission tier beyond platform-admin access.
- No alerting or notification workflow for schedule changes.
- No changes to cron processors or execution tracking semantics.

## Approach

Use database-backed preset overrides with immediate BullMQ reconciliation and worker-startup reconciliation.

The code-defined `CRON_JOBS` registry remains the default source of truth. A new platform-level override table stores only schedules that differ from the registry default. The effective schedule for a job is resolved as:

`default schedule from CRON_JOBS` plus `optional database override` equals `effective schedule`.

This keeps defaults simple, makes reset-to-default a delete operation, and preserves type-safe cron job names from the registry. It also avoids relying on BullMQ or Redis as the only durable source of schedule configuration.

## Data Model

Add a new table named `cron_schedule_override` in the application schema rather than the generated auth schema.

Columns:

- `id`: UUID primary key.
- `jobName`: cron job name, unique.
- `presetId`: selected preset identifier.
- `pattern`: cron pattern resolved from the preset at save time.
- `updatedBy`: platform admin user ID.
- `createdAt`: creation timestamp.
- `updatedAt`: update timestamp.

The table is platform-level, not organization-scoped. Only platform admins can read or mutate it through the worker queue actions. The `jobName` uniqueness constraint ensures one active override per cron job.

## Schedule Presets

Create a small preset catalog with stable IDs, labels, and cron patterns. The first version should include common operational intervals and the current defaults already used by Z8 jobs.

Initial preset examples:

- Every minute: `* * * * *`
- Every 5 minutes: `*/5 * * * *`
- Every 15 minutes: `*/15 * * * *`
- Every 30 minutes: `*/30 * * * *`
- Hourly: `0 * * * *`
- Every 3 hours: `0 */3 * * *`
- Daily at midnight: `0 0 * * *`
- Daily at 1 AM: `0 1 * * *`
- Daily at 2:30 AM: `30 2 * * *`
- Weekly: `0 0 * * 0`

The UI accepts only preset IDs. Server actions resolve preset IDs to patterns and reject unknown IDs. If a code-defined default pattern has no matching preset, that job remains visible but cannot be edited until a preset is added for its pattern.

## High-Risk Jobs

All visible cron jobs are editable, but high-risk jobs require extra confirmation copy. High-risk classification is a static registry-side or helper-side list for jobs that affect billing, cleanup, integrations, compliance, or important operational automation.

Examples include:

- `cron:billing-seat-reconciliation`
- `cron:execution-cleanup`
- `cron:organization-cleanup`
- Integration digest and escalation jobs
- Compliance-related enforcement jobs such as `cron:break-enforcement`

The extra confirmation is a guardrail only. It does not add a second permission model.

## UI Design

Extend the scheduled cron jobs table on `/platform-admin/worker-queue`.

Each row should show:

- Job name.
- Effective schedule label and pattern.
- Default schedule label and pattern when an override exists.
- Next run time from BullMQ when connected.
- Override status.
- Reconciliation warning if BullMQ's current repeatable pattern differs from the saved effective schedule.
- Edit and reset actions.

Editing opens a compact schedule form using existing UI primitives and `@tanstack/react-form`. The form contains preset-only choices and submits to a server action. Reset removes the override and reschedules the job to its registry default. High-risk edit and reset flows show an additional confirmation message before submitting.

On small screens, the table can keep the current horizontal overflow pattern. Empty states should remain simple and consistent with the existing worker queue page.

## Server Actions

Add server actions near the current worker queue actions:

- `updateCronSchedule(jobName, presetId, confirmation?)`
- `resetCronSchedule(jobName, confirmation?)`

Each action should:

- Require platform-admin access through `PlatformAdminService.requirePlatformAdmin()`.
- Validate that the job exists in the cron registry.
- Keep hidden jobs such as `cron:telemetry` non-editable.
- Validate that the preset exists.
- Require high-risk confirmation for high-risk jobs.
- Save the override or delete it for reset/default-equivalent schedules.
- Attempt immediate BullMQ reconciliation for the affected job.
- Log a platform-admin audit entry with old schedule, new schedule, target job, admin user, and reconciliation result.
- Return a success result when the database change is saved, with a warning when immediate BullMQ reconciliation fails.

## BullMQ Reconciliation

Create a reusable reconciliation helper for one job and for all jobs.

The one-job helper should remove stale repeatable entries for the job name, then add the effective repeatable job using the existing consistent job ID and existing default job options. It must preserve the existing cron job data shape so execution tracking still creates execution rows for scheduler-triggered jobs.

The all-jobs helper is used by worker startup. It loads effective schedules, removes stale repeatables for registry jobs, and adds repeatables for each effective schedule when `ENABLE_CRON_JOBS` is not `false`.

If BullMQ is unreachable during a platform-admin edit, the database override remains saved. The UI reports that the schedule is saved but immediate rescheduling failed, and worker startup will retry reconciliation.

## Data Flow

Page load:

1. `/platform-admin/worker-queue` calls the existing `getWorkerQueueStats()`.
2. The action loads current BullMQ repeatable jobs as it does today.
3. It also loads schedule overrides from Postgres.
4. Scheduled-job rows include default schedule, effective schedule, preset ID, override status, high-risk status, next run, and mismatch status if BullMQ differs from the effective schedule.

Update schedule:

1. Platform admin selects a preset and confirms the change.
2. The server action validates platform-admin access, job name, preset ID, visibility, and high-risk confirmation when needed.
3. The action upserts the override if the preset differs from default, or deletes the override if it matches the default.
4. The action reconciles the affected BullMQ repeatable job to the effective schedule.
5. The action logs the audit entry.
6. The UI refreshes the worker queue page.

Reset schedule:

1. The server action deletes the override.
2. It reconciles BullMQ back to the default registry schedule.
3. It logs the reset action.
4. The UI refreshes the worker queue page.

Worker startup:

1. The worker checks `ENABLE_CRON_JOBS` as it does today.
2. It loads effective schedules from the registry plus database overrides.
3. It removes stale repeatables for known registry jobs.
4. It adds repeatable jobs using effective schedules and existing job options.

## Error Handling And Safety

Schedule changes fail closed on authorization errors. Unknown jobs, hidden jobs, unknown presets, and missing high-risk confirmation are validation errors.

Preset-only input avoids arbitrary cron parsing in the first version. Schedule rows should make mismatch states visible when BullMQ's current repeatable pattern differs from the saved effective schedule.

If the database write succeeds but BullMQ reconciliation fails, the action returns a warning-style success instead of rolling back the saved schedule. This preserves the admin's durable intent and allows worker startup to reconcile later.

The reconciliation helper should avoid duplicate repeatables by removing stale entries for the job before adding the effective schedule. It should not modify unrelated non-registry repeatable jobs.

## Testing

Add focused automated tests for:

- Preset catalog IDs, labels, and patterns.
- Effective schedule resolution with and without overrides.
- Override upsert and reset/delete behavior.
- Platform-admin authorization for schedule mutations.
- Hidden and unknown cron jobs being rejected.
- High-risk jobs requiring confirmation.
- BullMQ reconciliation removing stale repeatables and adding the effective schedule.
- Warning result when database save succeeds but immediate BullMQ reconciliation fails.
- Worker startup using effective schedules and reconciling stale BullMQ repeatables.
- Scheduled jobs table rendering override/default schedule state.

Manual verification should cover editing a low-risk job, editing a high-risk job with confirmation, resetting to default, queue disconnected behavior, and worker restart reconciliation.

## Documentation

Update the platform-admin guide to mention that worker queue scheduled jobs can be edited by platform admins through preset schedules and reset to code defaults.

## Risks And Mitigations

- Risk: An unsafe schedule could overload workers or delay important automation. Mitigate with preset-only input and high-risk confirmations.
- Risk: BullMQ and Postgres can temporarily disagree. Mitigate with visible mismatch status and worker-startup reconciliation.
- Risk: Duplicate repeatables can be created if old patterns are not removed. Mitigate with a tested reconciliation helper that removes stale entries by job name before adding the effective schedule.
- Risk: Defaults can drift when code schedules change. Mitigate by storing overrides only for non-default schedules and showing both effective and default schedules in the UI.
- Risk: A default pattern without a preset cannot be edited safely in a preset-only UI. Mitigate by showing the schedule read-only until a matching preset is added.
