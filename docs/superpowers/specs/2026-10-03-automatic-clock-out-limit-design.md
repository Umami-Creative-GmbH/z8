# Organization Automatic Clock-Out Limit

Date: 2026-10-03

Status: Written specification and implementation plan approved on 2026-10-03. Implementation follows the selected Subagent-driven workflow; final whole-branch review is pending.

GitHub: [Spec issue #568](https://github.com/Umami-Creative-GmbH/z8/issues/568), assigned to KaiSoellch.

## Intent and agreed behavior

Give organizations a configurable ceiling on an employee's uninterrupted live work. When live work reaches that ceiling, the server automatically clocks the employee out and informs them. Enforcement must work without an open browser.

The user approved these decisions:

- The setting belongs in Organization Settings and applies organization-wide.
- It is enabled by default, with a 12-hour limit, for existing and new organizations.
- Owners and admins can change the duration or disable enforcement.
- A recorded break resets the allowance. A new clock-in starts a new allowance.
- Enabling, disabling, or changing the duration applies to ongoing live work on the next background check.
- Check every **five minutes**, as explicitly requested by the user.
- Record the clock-out at the calculated cutoff, rather than the time the job runs.
- Lowering the limit can backdate the clock-out. For example, lowering it to eight hours while an employee has already worked ten hours closes that still-live work at its eight-hour mark.
- Create an employee notification explaining the automatic clock-out, its time, and the applicable limit, with a link to the work record.
- Identify automatic clock-outs in the work record.

Approval was given after the five-minute cadence replaced the initially proposed one-minute cadence. This specification preserves the originally proposed backdating rule.

## Approach

Add a scheduled scan to the existing BullMQ cron system. Each execution discovers overdue live work and processes it through the shared Clocking module, then delivers durable follow-up tasks.

The alternative considered was a delayed job for every clock-in, backed by a recovery scan. That would provide lower latency but also require canceling or rescheduling jobs after breaks and configuration changes. The user accepts five-minute checks, so the recurring scan meets the need with fewer moving parts.

During normal job operation, the employee may remain visibly clocked in for up to five minutes beyond the cutoff. A worker outage can delay processing longer; recovery still uses the calculated cutoff. Scheduler cadence is not an exact execution-time guarantee.

## Settings and permissions

Add an Automatic clock-out section to the existing Organization Settings screen:

- An enabled toggle, defaulting to on.
- A duration input expressed as hours and minutes, defaulting to 12 hours.
- Clear help text: a recorded break resets the limit; changes also affect ongoing work; checks run every five minutes.
- A Save action with pending, success, and validation feedback following existing settings patterns.

Disabling enforcement preserves the configured duration for later re-enabling. Store the duration as a positive integer number of minutes, within the PostgreSQL integer range. Validate complete numeric inputs, positivity, and overflow on the server as well as in the form. Reject invalid values rather than silently coercing them.

Use TanStack Form and Tolgee translations, existing UI components, and existing organization authorization helpers. Only approved owners/admins of the active organization may read or change the administrative setting through its settings action. Never authorize solely from a submitted organization ID.

Store configuration in a dedicated `organization_time_tracking_settings` table, with a unique organization ID referencing the organization, `autoClockOutEnabled`, `maxUninterruptedMinutes`, revision, and timestamps. Avoid modifying the generated auth schema. Defaults are enabled and 720 minutes. A missing row has the same effective defaults, so new organizations are covered without depending on a particular creation flow.

Configuration changes take the existing organization configuration guard exclusively and increment the revision. Automatic clock-out reads current configuration under the corresponding shared guard. This guarantees that once a settings change commits, subsequent closures cannot be decided using an earlier setting.

## Limit calculation and breaks

The authoritative interval is the named live work period's UTC start instant to its cutoff:

`cutoff = live work start instant + current organization limit in minutes`

The work is due when `now >= cutoff`. Use Temporal instants and durations, with an injected clock for tests. Convert to native Date only at database or external boundaries. Midnight, daylight-saving changes, employee travel, and the viewer's timezone do not change elapsed-time arithmetic.

The existing break command closes work at the break start and resumes a new live work period afterward. The resumed period's start therefore resets the allowance. Ordinary clock-out followed by clock-in likewise starts fresh. A retroactive automatic break deduction after work is closed does not reset or extend an active limit.

The scan acts only on still-live periods. A manual clock-out, break, on-behalf clock-out, departure, or correction that commits before the automatic closure wins according to the shared work transaction. Do not truncate already completed work or change a break's newly resumed period because an earlier scan selected its predecessor. Consequently, an employee who manually closes work after the deadline but before the next scan retains that completed record's normal clock-out behavior.

This setting is separate from work-policy compliance limits and automatic break enforcement. Those existing follow-ups continue to apply to completed work.

## Scheduled processing

Register `cron:auto-clock-out` with schedule `*/5 * * * *` in the existing cron registry and schedule configuration. The existing authenticated scheduling/manual-trigger infrastructure and worker dispatch run it; no new public clock-out endpoint is required.

Discovery joins organizations, effective settings, employees, and live work periods. Select only nondeleted organizations and periods whose `isActive` is true, `endTime` is null, and `deletedAt` is null, with enabled settings and a due cutoff. Include overdue periods from any date, not merely today. Every target includes its organization ID, employee ID, and exact work period ID.

Process candidates in bounded batches with deterministic pagination. Advance past a failed candidate within the run so failures cannot starve later work. Each employee's closure uses its own transaction. Report attempted, closed, skipped, deferred, and failed counts, plus organization/period-scoped errors through existing cron observability. Subsequent scans rediscover still-live overdue work.

Inside each work transaction:

1. Acquire the existing guards in the coordinator's required rank order, including organization configuration and employee coordination.
2. Reload effective settings and the exact target work period under those guards. Confirm organization/employee ownership, live state, enabled status, and the current cutoff against the clock.
3. If no longer due or no longer live, return a harmless skipped outcome without touching another period.
4. Establish a stable operation identity from the organization, employee, period, start instant, settings revision, and cutoff. Retries of the same decision must reuse its identity and evidence.
5. Run the system clock-out through the shared Clocking module, preserving project, work category, and work location attribution.
6. Commit the closure, audit evidence, and durable notification/follow-up tasks atomically. A staging failure rolls the transaction back.

Do not select a cutoff outside the transaction and later close under stale settings. Discovery is only a hint. Any scope change uses the existing coordinator restart mechanism rather than acquiring earlier-ranked guards late.

## Clocking integration and system authority

Extend the Clocking module with a narrowly scoped automatic-clock-out system principal/channel. It may close only the specified overdue live work in its own organization, through a trusted internal adapter bound to that decision's work transaction. It may not clock in, create a break, or act on arbitrary work. HTTP, web, desktop, and bot adapters cannot construct this authority from user input.

Follow the existing enlisted transaction pattern, but give automatic clock-out its own scope binding; do not pretend that it is an employee departure or a human self-service action. Clocking retains ownership of legacy/append admission selection, replay, and canonical work creation as required by the accepted ADRs.

Automatic closure is not conditional on a browser session or active subscription. Its narrow system authority closes already-running overdue work without granting access to start or edit work. Keep ordinary human clocking and departure permissions unchanged. Revalidate organization and period scope in the transaction; a retired/deleted period or another writer's completed closure is skipped.

Add a dedicated `automatic_clock_out` completed-work writer and `automatic-clock-out` source evidence. For append admission, record a system actor with no human actor ID, plus the process name, limit, configuration revision, start, cutoff, and processing instant in committed evidence. Update writer constraints, the writer inventory, and rollback compatibility/readiness declarations together.

Existing entry and canonical-record `createdBy` fields require a user foreign key. Retain the source clock-in's creator as technical database provenance, following the existing automatic-break-adjustment pattern, while recording and displaying system execution explicitly. That provenance must never be presented as the employee having manually performed the clock-out. Legacy closures also keep automatic source/reason evidence and a durable execution record, even where ordinary legacy clocking has no completed-work receipt.

Capture the clock-out timezone from the target employee's effective saved timezone, falling back to the organization timezone and then UTC. Derive the UTC offset at the **cutoff instant**, not at job execution. Use a system-specific timezone source; never use a manager, viewer, worker host, or browser timezone. The worker has no device-location evidence and must not invent it.

Late/offline commands keep the existing conflict and correction semantics. They must not recreate a closed period, silently undo automatic closure, or append orphan clock-out entries. Later corrections use the ordinary time-correction workflow.

## Durable follow-ups and employee notification

Commit an automatic-clock-out execution record and durable task rows with each successful closure. Bind them by organization, employee, period, and operation identity. These records are sufficient to recover delivery after a restart in both admissions. Use database uniqueness for task deduplication.

Stage the existing clock-out follow-ups using immutable closure evidence: compliance, automatic break enforcement, surcharge reconciliation, balance refresh, and project budget checks. Reuse their owners; do not copy domain calculations into the job. Respect committed work-balance/automatic-break intents to avoid staging duplicate domain work. Follow-up delivery failures never undo a committed clock-out.

Add an `automatic_clock_out` notification type and localized employee-facing copy. The in-app inbox notification is mandatory for this system action even if the employee has muted optional channels. It contains the configured duration, cutoff time rendered with the event's timezone context, an automatic-clock-out explanation, and a link to the affected work record in time tracking/calendar. Resolve language through the existing recipient-language rules.

Optional push, email, and supported organization messaging channels use existing availability and preference rules. Store delivery state per task/channel and use the operation identity as the deduplication key. Retry failed channels without recreating the inbox notification or resending channels already marked delivered. External transports retain their existing delivery guarantees; a transport that accepts a message and loses its acknowledgement can cause a retry duplicate.

Only notify for a successfully committed automatic closure. An already manually closed target, a disabled setting, a stale scan candidate, or a refused automatic attempt creates no success notification. Completed notification work remains deliverable if the organization later disables enforcement.

## Error handling and recovery

- Already closed, replaced, no longer due, or disabled: skip without creating entries or notifications.
- Scope changes: restart through the coordinator.
- Transaction/connection failure: rollback and retry on a later scan; isolate other employees from the failure.
- Uncertain commit: resolve against durable execution/operation evidence before attempting a new closure.
- Integrity conflict, unresolved review, or invalid work interval: preserve existing evidence, report the blocker, and retry only through existing safe rules. Never bypass a review or repair work automatically.
- Follow-up or transport failure: retain durable task state and retry independently of whether the original period is still active.

The same five-minute job recovers pending tasks as well as finding new overdue work. Configuration changes never rewrite committed automatic decisions or prior notifications.

## Verification

Unit coverage:

- Effective defaults, disabling/re-enabling, positive duration validation, and overflow rejection.
- Below, exactly at, and beyond the cutoff; arbitrary configured duration; settings changes on ongoing work; break reset.
- UTC elapsed time across midnight, daylight-saving transitions, and differing viewer/employee timezones.
- Five-minute registry/schedule configuration, batching, pagination past failures, and isolated outcomes.
- Mandatory localized inbox content, optional channel suppression, task retries, and deduplication.

PostgreSQL integration coverage in both legacy and append admission:

- Close the intended period at the calculated cutoff; preserve attribution, event-local capture, and system audit evidence.
- Duplicate workers and repeated scans create one closure and one inbox notification.
- Race automatic closure with self-service clock-out, break/resume, on-behalf closure, departure, and settings enable/disable/duration changes.
- Refuse cross-organization targets and attempts to reuse system authority from ordinary adapters.
- Roll back closure when task staging fails; recover delivery after a committed closure and simulated worker restart.
- Continue after employee-specific failures; recover periods from previous dates.
- Preserve reviews/corrections and enforce existing late/offline command conflict behavior.
- Verify writer constraints, inventory, and rollback/readiness compatibility for the new writer.

UI/runtime verification:

- Owners/admins can load and save the setting; other roles cannot mutate it.
- Defaults, retained disabled duration, validation messages, loading feedback, localization, keyboard access, and light/dark themes.
- Clock status refresh shows the completed work and automatic source using existing polling/invalidation paths.
- Run relevant unit/integration suites and repository type/lint checks. Follow the required React/Next and UI quality checks during implementation.

## Scope boundaries and references

This feature adds no warning countdown, daily total-work cap, minimum qualifying break duration, manager notification, or new clock-in restriction. It does not automatically rewrite completed work or override the existing correction process.

Relevant existing modules:

- `apps/webapp/src/app/[locale]/(app)/settings/organizations/` and `apps/webapp/src/components/organization/` for administrative settings.
- `apps/webapp/src/lib/cron/`, `apps/webapp/src/lib/jobs/`, and the existing worker for scheduling and recovery.
- `apps/webapp/src/lib/time-tracking/clocking/`, `close-active-work.ts`, and the work transaction coordinator for all clock-out writes.
- `apps/webapp/src/lib/notifications/` for localized inbox and channel delivery.
- `apps/webapp/src/db/schema/` and Drizzle migrations for settings, system writer evidence, notification type, and durable tasks.

This design follows the Timekeeping Reference and the accepted Time Tracking ADRs: the coordinator owns acquisition order; Clocking owns both admissions; work policies remain captured evidence. The new live enforcement setting is organization configuration because it decides whether and when live work is closed. It is not a work-policy amendment and does not reopen those ADRs.

## Review checkpoint

The user approved this specification and its implementation plan and selected Subagent-driven execution. Tasks 1–5 have passed their independent review gates; Task 6 adds scheduled maintenance and final verification. Build and authenticated browser verification require the unavailable Phase runtime environment. Final whole-branch review and any PR publication remain separate gates; plan approval does not authorize merging.
