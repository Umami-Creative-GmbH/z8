# Compliance Copilot Design

Real-time warnings for rest-time, max-hours, and overtime violations before schedules are published.

## Goals

- Surface compliance risk while managers are building schedules (target feedback under 2 seconds).
- Keep publish behavior warning-first (never hard-block on compliance findings).
- Require explicit manager acknowledgment when publishing with warnings.
- Preserve strict multi-tenant boundaries (all reads/writes org-scoped).

## Non-Goals

- No automatic reassignment or auto-fix of problematic shifts.
- No blocking behavior changes for coverage logic (existing coverage rules stay independent).
- No evaluation for open (unassigned) shifts.

## Approaches Considered

### A) Live evaluator + publish checkpoint (selected)

Run compliance evaluation after scheduler edits and again at publish time. Show inline warnings during editing and require acknowledgment in a publish modal if findings exist.

Pros:
- Best manager UX (fast, continuous feedback).
- Reuses existing scheduling actions and Effect service architecture.
- Keeps final publish-time safety check.

Cons:
- Higher request volume than publish-only checks.

### B) Publish-only evaluator

Evaluate compliance only when manager clicks publish.

Pros:
- Lowest implementation complexity.

Cons:
- No real-time guidance while building schedules.
- More late-stage rework for managers.

### C) Event-driven background engine

Continuously compute compliance snapshots from an async pipeline and read cached results in UI.

Pros:
- Scales well for very large orgs.

Cons:
- Highest implementation and operational complexity.
- Slower time-to-value.

## Selected Design

### Architecture

Add a schedule-specific compliance evaluation service in the existing Effect layer, aligned with patterns used in scheduling and compliance services.

- New service (tentative): `ScheduleComplianceService` in `apps/webapp/src/lib/effect/services/`.
- Reuse existing policy and regulation fields from `workPolicyRegulation`:
  - `minRestPeriodMinutes`
  - `maxDailyMinutes`
  - `overtimeDailyThresholdMinutes`, `overtimeWeeklyThresholdMinutes`, `overtimeMonthlyThresholdMinutes`
- Evaluate using combined baseline: actual worked minutes (`workPeriod`) + planned minutes (`shift` with draft/published in range).
- Keep results normalized into summary + per-employee findings + severity and publish metadata.

### Components

#### Server

1. `evaluateScheduleWindow({ organizationId, startDate, endDate, timezone })`
   - Runs for inline/live warnings.
2. `evaluatePublishAttempt({ organizationId, startDate, endDate, timezone })`
   - Final publish checkpoint.
3. `recordPublishAcknowledgment({ organizationId, actorEmployeeId, dateRange, findingSummary, fingerprint })`
   - Audit record when publish proceeds with warnings.

#### Scheduling actions

Extend `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts` to:
- expose a compliance-check action for the active scheduler range,
- gate publish with `requiresAcknowledgment` when findings exist,
- accept and verify acknowledgment payload before final publish.

#### UI

Extend scheduler UI near `shift-scheduler.tsx` and `publish-fab.tsx`:
- inline warning banner/chips for live findings,
- publish modal summarizing findings by category,
- required explicit acknowledgment control before final publish submission.

### Data Model

Add a compliance publish-ack table (name tentative: `schedule_publish_compliance_ack`) with:

- `id`
- `organizationId`
- `actorEmployeeId` (manager/admin performing publish)
- `publishedRangeStart`, `publishedRangeEnd`
- `warningCountTotal`
- `warningCountsByType` (JSON)
- `evaluationFingerprint` (hash/version of evaluated result)
- `createdAt`

Indexes:
- `organizationId, createdAt`
- `actorEmployeeId, createdAt`

## Data Flow

### Live warning flow

1. Manager edits schedule.
2. UI mutation succeeds.
3. UI requests compliance eval for visible range.
4. Server returns findings.
5. UI updates inline warning surfaces.

### Publish flow

1. Manager clicks publish.
2. Server runs existing coverage checks and compliance publish evaluation.
3. If compliance findings exist, return `requiresAcknowledgment: true` with summary and fingerprint.
4. UI opens publish modal with grouped findings (rest-time, max-hours, overtime).
5. Manager confirms acknowledgment.
6. UI resubmits publish with acknowledgment payload.
7. Server revalidates payload, publishes, and writes acknowledgment audit record.

## Rule Semantics

- Publish with findings is allowed (warn-only model).
- Open/unassigned shifts are ignored by compliance evaluator.
- Compliance warnings are employee-specific and org-scoped.
- Finding categories included in v1:
  - rest-time conflicts,
  - max-hours risk/violation,
  - overtime risk/violation.

## Error Handling

- Live eval failures are non-blocking in UI; show temporary unavailable notice.
- Publish eval failures return actionable error; publish does not proceed silently without evaluation.
- Acknowledgment payload must match organization, date range, actor role, and current evaluation fingerprint.
- On stale or mismatched fingerprint, server returns updated findings and requires reconfirmation.

## Security and Multi-Tenancy

- Every query filtered by `organizationId`.
- Publish and acknowledgment require manager/admin authorization.
- No cross-tenant joins or lookups in evaluation paths.

## Performance Targets

- Live warning refresh target: under 2 seconds for typical scheduler windows.
- Limit live evaluation to active date window and affected employees where possible.
- Batch queries per organization and range to avoid N+1 patterns.

## Testing Strategy

- Unit: rest-time cross-day checks, daily/weekly/monthly overtime projections, max-hours logic.
- Unit: open shifts excluded and org isolation.
- Integration: publish action returns `requiresAcknowledgment` when findings exist.
- Integration: publish with valid acknowledgment succeeds and persists audit record.
- Integration: stale/invalid acknowledgment is rejected.
- UI: inline warning updates, publish modal rendering, required confirmation before final publish.
- Regression: existing coverage publish behavior remains intact.

## Rollout Notes

- Ship behind a feature flag (org-level) if needed.
- Start with warning-only mode (no compliance hard-block).
- Monitor eval latency and publish-with-warning rates before wider rollout.
