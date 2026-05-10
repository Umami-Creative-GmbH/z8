# Platform Admin Worker And Cron Reliability Charts Design

## Context

`/platform-admin/worker-queue` already gives platform administrators queue counts, BullMQ repeatable cron jobs, 30-day aggregate job metrics, and recent executions. The page reads queue state from BullMQ and execution history from `cron_job_execution` through `getWorkerQueueStats()`, after enforcing platform-admin access.

The current view is useful for point-in-time inspection, but it does not make reliability trends obvious. Platform operators need to see whether workers and scheduled jobs are failing, becoming stale, or getting slower without manually scanning tables.

## Goals

- Add worker and cron reliability charts to `/platform-admin/worker-queue`.
- Surface all first-version reliability signals: failures, success rate, stale or missed cron runs, and runtime degradation.
- Use existing persisted execution data and BullMQ repeatable-job state.
- Preserve current queue counts, scheduled jobs, job metrics, and recent execution behavior.
- Keep the UI operational, restrained, responsive, and consistent with platform-admin patterns.

## Non-Goals

- No new database table or migration.
- No platform overview dashboard changes.
- No alerting, notification, or escalation workflow.
- No tenant-specific settings.
- No worker heartbeat implementation in this version.

## Approach

Use the existing-data reliability approach. Extend the worker queue page and its server action instead of creating a separate dashboard. This keeps the change small and makes reliability information available where platform operators already inspect workers and cron jobs.

The implementation should derive reliability data from:

- `cron_job_execution` for execution history, statuses, start times, completion times, errors, and durations.
- BullMQ queue counts for current queue connectivity and backlog state.
- BullMQ repeatable jobs for configured cron jobs, schedules, and next run times.

`cron:telemetry` remains hidden from the platform-admin worker queue view, matching the current filtering behavior.

## Data Flow

`getWorkerQueueStats()` remains the integration point. It should continue to call `PlatformAdminService.requirePlatformAdmin()` before loading queue or execution data.

The action should return the existing payload plus a new reliability payload. The reliability payload should include:

- Overall summary values for the last 30 days.
- Daily time-series buckets for completed and failed executions.
- Daily success-rate points.
- Daily duration points where duration data is available.
- Per-job health rows for registered cron jobs and jobs with recent execution history.

The existing 30-day window used by job metrics should also be used for the new charts. This keeps the UI consistent and avoids adding date-range controls in the first version.

If the queue connection is unavailable, the page should still show disconnected status and any database-backed reliability information that can be loaded. If execution-history queries fail, the page can use the existing load-error behavior.

## Reliability Rules

Success rate is calculated from terminal executions only:

- `completed / (completed + failed) * 100`
- `pending` and `running` executions are excluded from the denominator.
- If no terminal executions exist, success rate is unknown rather than zero.

Failed runs count executions with `status = "failed"` in the selected 30-day window.

Stale jobs compare each repeatable job's most recent execution to a threshold inferred from its cron pattern:

- Every minute jobs are stale after 10 minutes without a run.
- Every 5 minutes jobs are stale after 30 minutes without a run.
- Hourly jobs are stale after 3 hours without a run.
- Daily jobs are stale after 36 hours without a run.
- Other schedules are marked unknown if a reliable threshold cannot be inferred.

Runtime degradation is shown as daily average duration for completed or failed executions with `durationMs`. If database support makes p95 straightforward during implementation, p95 can be used instead of average; otherwise average duration is the first-version metric.

Per-job health states should be deterministic:

- `healthy`: recent terminal executions exist, success rate is at least 95%, and the job is not stale.
- `warning`: success rate is at least 80% but below 95%, or the job has no recent terminal executions but is not known stale.
- `failing`: success rate is below 80% or recent failures dominate the job's terminal executions.
- `stale`: the latest run is older than the inferred stale threshold.
- `unknown`: schedule or execution data is insufficient to classify the job.

When multiple states apply, use the highest operational risk: `stale`, then `failing`, then `warning`, then `healthy`, then `unknown`.

## UI Design

Add a new `Reliability` section to `/platform-admin/worker-queue`, between `Queue Status` and `Scheduled Cron Jobs`.

The section should include:

- A top row of reliability cards for overall success rate, failed runs, stale jobs, and average duration.
- A run outcomes chart showing daily completed and failed executions, with daily success rate available in the same chart card or adjacent summary.
- A duration trend chart showing daily average duration when enough duration data exists.
- A per-job health table with job name, status badge, last run, next run, success rate, failures, average duration, and health state.

Use existing UI primitives: cards, badges, tables, skeletons, and the shared `ChartContainer` Recharts wrapper. Chart imports should follow the existing dynamic-import pattern used in reporting components to avoid unnecessary server-side chart rendering.

The UI should include clear empty states when no execution history exists. On mobile, cards and charts stack vertically. Tables should remain readable with horizontal overflow where needed.

## Components And Boundaries

Keep data shaping separate from rendering so it can be tested without rendering Recharts.

Suggested boundaries:

- Route server action: loads queue and database data, enforces platform-admin access, and returns serializable reliability data.
- Pure reliability helpers: bucket executions by day, calculate success rates, infer stale thresholds, classify health state, and format per-job reliability rows.
- Client chart component: receives serializable chart data and renders the reliability chart cards.
- Existing page component: places the reliability section in the current worker queue layout.

This keeps the page from accumulating all reliability logic inline and makes the most important calculations independently testable.

## Testing

Add focused tests for pure reliability helpers:

- Daily buckets split completed and failed runs correctly.
- Success rate excludes pending and running executions.
- Stale thresholds classify common cron patterns correctly.
- Per-job health state prioritizes stale and failing states over warning and healthy states.
- Empty execution history returns unknown or empty-state data without throwing.

Add server-action tests if the current mocking surface is practical. If not, keep query changes minimal and rely on pure helper coverage plus existing page behavior.

Manual verification should include loading `/platform-admin/worker-queue` with execution history, no execution history, and a disconnected queue state if that is feasible without requiring unavailable environment secrets.

## Documentation

Update the platform admin guide to mention that `/platform-admin/worker-queue` includes reliability trends for worker and cron operations, not only queue status and recent executions.

## Risks And Mitigations

- Cron pattern inference may be incomplete. Mitigate by marking unsupported schedules as unknown instead of presenting false stale warnings.
- Duration averages can hide outliers. Keep labels explicit and leave p95 as an implementation-time improvement only if easy and reliable.
- The worker queue page can become dense. Keep the reliability section compact and preserve the existing table sections below it.
- Queue connectivity and database history can disagree. Treat them as separate signals: queue connectivity reports current BullMQ access, while reliability charts report persisted execution history.
