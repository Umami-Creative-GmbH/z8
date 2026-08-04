# BullMQ v6 Hard Rollout Design

## Goal

Upgrade Z8 from BullMQ 5.81.3 to BullMQ 6 without retaining compatibility code for legacy repeatable jobs. Adopt BullMQ Job Schedulers as the only cron scheduling mechanism and reset the small production queue during deployment.

## Context

BullMQ 6 removes the repeatable-job APIs currently used by Z8: `Queue.add(..., { repeat })`, `getRepeatableJobs`, and `removeRepeatableByKey`. The current dependency update therefore fails typechecking and cannot be deployed safely as-is.

The application currently serves four live users. Pending and delayed queue jobs, BullMQ-managed cron metadata, and queue history may be discarded during this rollout. Database-backed cron definitions, schedule overrides, and execution records must remain unchanged.

## Application Changes

### Cron Reconciliation

Use one deterministic Job Scheduler ID per cron job: `cron-${jobName}`.

`reconcileCronJobSchedule` will call `upsertJobScheduler` with:

- The configured cron `pattern`.
- The existing cron job name and payload.
- Existing attempts, priority, completion retention, and failure retention options in the job template.

Upserting the same scheduler ID must update a changed schedule without creating duplicates. Worker startup will reconcile every configured cron job so a reset queue recreates all schedulers automatically.

The reconciliation path will contain no calls to legacy repeatable-job APIs and no migration fallback for old Redis metadata.

### Queue Dashboard

Read cron schedules with `getJobSchedulers` and map scheduler name, pattern, and next execution time into the existing scheduled-job view.

BullMQ 6 reports jobs in a paused queue as waiting and removes the `paused` job count. The dashboard will represent pause as queue state obtained from `isPaused`, not as a separate job count. Waiting jobs remain reported once as waiting and are not duplicated into a paused count.

### Dependencies

Use BullMQ 6.0.7 or a newer compatible 6.0 patch because 6.0.7 fixes a worker blocking-read reconnect issue present in 6.0.6.

Keep the explicit ioredis 6 dependency required by the Redis backend. Do not force RESP2 preemptively; verify the existing Redis/Valkey configuration under ioredis 6's RESP3 default.

Do not adopt BullMQ's PostgreSQL backend, custom backend abstraction, or telemetry adapter in this change. They do not solve a current Z8 requirement.

## Deployment

Perform the rollout in this order:

1. Stop all existing web and worker processes that can produce or consume `z8-jobs`.
2. Obliterate only the BullMQ `z8-jobs` queue using the application's configured Redis connection and BullMQ API.
3. Deploy the BullMQ 6-compatible web and worker code.
4. Start one worker and allow startup reconciliation to recreate all Job Schedulers.
5. Verify the expected scheduler count, IDs, cron patterns, and next execution times.
6. Start the remaining application processes.
7. Confirm a scheduled job executes and Redis reconnects without leaving the worker blocked.

The reset must not flush the Redis database or delete unrelated keys. The operation intentionally loses pending, delayed, active, completed, and failed BullMQ job data for `z8-jobs`.

## Error Handling

Scheduler reconciliation keeps the current per-job result behavior: a failed upsert returns a failure result without crashing reconciliation for every other schedule. Worker startup must continue to surface reconciliation failures in logs.

The queue reset must fail closed: if the queue cannot be obliterated, deployment stops before the BullMQ 6 worker starts. Scheduler verification failure likewise blocks completion of the rollout.

## Testing

Use test-driven development for behavior changes.

Focused unit tests must demonstrate:

- A scheduler is upserted with a deterministic ID, pattern, payload, and existing job options.
- Reconciliation of all schedules upserts one scheduler per cron job.
- An upsert failure is returned without throwing from the single-job reconciliation API.
- Scheduler records map correctly into the platform dashboard.
- Queue pause state is represented independently from waiting-job counts.

Verification must include:

- Webapp typecheck.
- Focused cron, queue-health, dashboard action, and worker tests.
- Production build with `CI=true`.
- A disposable Redis/Valkey smoke test that upserts, lists, updates, and removes a scheduler.
- A worker reconnect smoke test after Redis/Valkey restart.

Environment-dependent smoke tests that require deployment credentials must be performed during rollout rather than by the coding agent.

## Success Criteria

- No source code references BullMQ's removed repeatable-job APIs or paused job count.
- Typechecking and focused tests pass with BullMQ 6.
- Queue startup creates exactly one Job Scheduler for each configured cron job.
- Schedule changes update existing schedulers rather than creating duplicates.
- The platform dashboard shows scheduler data and queue pause state accurately.
- The deployment resets only `z8-jobs` and leaves unrelated Redis data intact.
