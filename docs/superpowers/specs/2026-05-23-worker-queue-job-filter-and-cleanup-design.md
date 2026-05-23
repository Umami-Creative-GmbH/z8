# Worker Queue Job Filter And Execution Cleanup Design

## Context

`/platform-admin/worker-queue` currently shows the global last 50 cron executions from `cron_job_execution`. High-frequency jobs can push lower-frequency jobs, such as jobs running every three hours, out of that global list. The execution history is stored in Postgres through `apps/webapp/src/lib/cron/tracking.ts` and the `cron_job_execution` table. A `cleanupOldExecutions(daysToKeep = 90)` helper exists, but it is not registered in the daily cron registry.

## Goals

- Let platform admins filter the Recent Executions table by job name in-page.
- Keep the default Recent Executions view as the existing global last 50.
- When a job is selected, show that job's last 50 executions so infrequent jobs remain inspectable.
- Register a once-daily cron cleanup job that deletes execution records older than 90 days.
- Reuse existing worker queue and cron tracking patterns.

## Non-Goals

- No URL query parameter or bookmarkable filter state.
- No new retention configuration UI.
- No broad redesign of the worker queue dashboard.
- No changes to BullMQ retention settings.

## Design

### Recent Executions Filter

Add a small client component for the Recent Executions section. It receives the initial global last 50 executions and a list of visible job names from the server-rendered stats. The component renders an in-page job selector with an `All jobs` option.

Selecting `All jobs` restores the initial global execution list. Selecting a specific job calls a focused server action that validates the user is a platform admin, validates the job name, and returns `getJobExecutionHistory(jobName, 50)` mapped into the existing serializable `RecentExecution` shape.

The job list should be built from non-hidden jobs already available to the page: repeatable jobs, job metrics, reliability jobs, and initial recent executions. `cron:telemetry` remains hidden via the existing hidden-worker filter.

### Cleanup Cron

Add a new cron registry entry named `cron:execution-cleanup` scheduled once daily. The processor calls a small job module that runs `cleanupOldExecutions(90)` and returns metadata:

```ts
{
	success: true,
	deletedCount: number,
	daysToKeep: 90,
}
```

The cron runs through the existing worker registry, so its own success or failure is tracked in `cron_job_execution` like the other scheduled jobs.

## Error Handling

- If a filtered execution fetch fails, show a concise inline error in the Recent Executions section and keep the previous table state if possible.
- If no executions exist for the selected job, show the existing empty-state wording adjusted for the selected filter.
- Cleanup failures should bubble through the cron processor so they are recorded as failed executions.

## Testing

- Add server-action coverage for fetching the last 50 executions for a selected job and rejecting invalid/hidden job names.
- Add client component coverage for switching between all jobs and a selected job if an existing test setup supports it without heavy scaffolding.
- Add cron registry/job coverage proving `cron:execution-cleanup` is registered with a once-daily schedule and calls `cleanupOldExecutions(90)`.

## Open Decisions

- Use a fixed 90-day retention window, matching the existing helper default.
- Keep filter state local to the page and reset on navigation or refresh.
