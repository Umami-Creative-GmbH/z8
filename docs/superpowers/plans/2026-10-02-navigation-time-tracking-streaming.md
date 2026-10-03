# Time Tracking Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show usable clock controls as soon as their inputs resolve, independently of timeline, summary, balance, and history.

**Architecture:** Authorize once, then render four sibling async regions under independent Suspense boundaries. Date parameters belong to the timeline; data errors belong to their region while framework control-flow errors are rethrown.

**Tech Stack:** Next.js 16.3.4 Cache Components/Partial Prefetching, React Suspense, Vitest.

**Spec:** [Section 2](../specs/2026-10-02-navigation-performance-design.md). Requires the interfaces from [change 1](2026-10-02-navigation-rendering-reads.md) and the [delivery checklist](2026-10-02-navigation-performance.md).

## Global Constraints

- Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.
- Unknown active-period status never becomes a clocked-out state. Auth/access failures happen before protected content is returned.
- Selected date changes only timeline semantics. Preserve existing mutation authorization and refresh behavior.
- Source paths are relative to `apps/webapp`; inherit the delivery plan's constraints and verification gates.

## Review Focus

1. A never-resolving timeline/date parameter must not prevent clock readiness.
2. Failed active-period reads cannot show enabled clock actions.
3. One failed secondary region leaves completed siblings usable.
4. Redirect/not-found/prerender control flow must escape region catches.
5. A refresh after clock mutation or a date-only navigation retains the right independent region data.

## File structure

Create under `src/app/[locale]/(app)/time-tracking/`:

- `region-data.ts`: scoped reads for summary/history and safe balance fallback.
- `timeline-serialization.ts`: existing display-safe timeline serialization.
- `regions.tsx`: the four async components and authorized page content.
- `region-fallbacks.tsx`: current skeleton dimensions and inline retry/error UI.
- `region-data.test.ts`, `regions.test.tsx`, `timeline-serialization.test.ts`.

Modify `page.tsx`, `page-data.ts`, `page-data.test.ts`, and the endpoint-surface regression test. Preserve the four existing Client Components and their existing props. Reuse an existing translated error/retry pattern; add error keys only to the existing common catalog if no equivalent exists, with normal locale coverage.

### Task 1: Separate region data and safe failure handling

**Interfaces:** Consumes `EmployeeRenderContext`, `EmployeeReadScope`, and change 1's three readers. Produces:

```ts
type SummaryRegionData = { summary: TimeSummary; workBalance: EmployeeWorkBalancePayload | null };
type HistoryRegionData = { workPeriods: WorkPeriodWithEntries[]; hasManager: boolean; canApproveTimeEntries: boolean };
readSummaryRegion(context: EmployeeRenderContext): Promise<SummaryRegionData>
readHistoryRegion(context: EmployeeRenderContext): Promise<HistoryRegionData>
serializeWorkdayTimelineResult(result: WorkdayTimelineResult): SerializableWorkdayTimelineResult
```

Use the existing `EmployeeWorkBalancePayload` type consumed by `WeeklySummaryCards`. History computes its existing week range and manager eligibility internally; approval capability remains membership role `admin`/`owner`. Summary starts summary/balance concurrently. Serialization preserves exactly the existing fields and drops internal Temporal objects.

- [ ] **Step 1: Add failing tests.** Move existing balance-fallback assertions to `region-data.test.ts`, reducing logs to safe metadata rather than embedding arbitrary error/session objects. Pin serialization for success/error, warnings, links, selected date keys/labels. Mock independent services and verify pending history/manager work never starts in `readSummaryRegion`; summary never starts in history. Preserve role semantics and weekly range:

```ts
expect(await readHistoryRegion(employeeContext)).toMatchObject({ hasManager: true, canApproveTimeEntries: true });
expect(await readSummaryRegion(employeeContext)).toEqual({ summary: expectedSummary, workBalance: null });
expect(serializeWorkdayTimelineResult(successFixture)).toEqual(serializableFixture);
```

Use fixed time/zone fixtures from existing timezone tests, including Sunday/Monday and DST. Include rethrow tests for framework control flow using the pinned Next.js `unstable_rethrow` utility in catch sites, rather than maintaining a list of digest strings.

- [ ] **Step 2: Run to see failure.** `pnpm exec vitest run --project unit 'src/app/[locale]/(app)/time-tracking/region-data.test.ts' 'src/app/[locale]/(app)/time-tracking/timeline-serialization.test.ts'`. Expected: missing interfaces fail.
- [ ] **Step 3: Implement readers and serializer.** Extract existing calculations, safe work-balance behavior, and serializer from `page-data.ts`. Only the history path reads manager eligibility and weekly history; only summary reads balance. Keep framework failures outside normal error conversion. Retain `page-data.ts` until the composition task removes its last callers; confirm callers with `rg` before removal.
- [ ] **Step 4: Verify.** Rerun step 2 and existing `workday-timeline-data.test.ts`, `workday-timeline-date.test.ts`, `workday-timeline-normalize.test.ts`, `src/lib/time-tracking/timezone-utils.test.ts`. Expected: unchanged results. Run shared typechecks.
- [ ] **Step 5: Commit.** Stage exact reader/serializer/test files; `git commit -m 'refactor: separate time tracking region data'`.

### Task 2: Compose independent Suspense regions

**Interfaces:** Consumes task 1 and change 1. Produces these server component signatures in `regions.tsx`:

```ts
ClockRegion({ context }: { context: EmployeeRenderContext }): Promise<React.ReactNode>
TimelineRegion({ context, searchParams }: { context: EmployeeRenderContext; searchParams: Promise<TimeTrackingPageSearchParams> }): Promise<React.ReactNode>
SummaryRegion({ context }: { context: EmployeeRenderContext }): Promise<React.ReactNode>
HistoryRegion({ context }: { context: EmployeeRenderContext }): Promise<React.ReactNode>
TimeTrackingPageContent({ searchParams }: { searchParams: Promise<TimeTrackingPageSearchParams> }): Promise<React.ReactNode>
```

`region-fallbacks.tsx` exports `ClockLoading`, `TimelineLoading`, `SummaryLoading`, `HistoryLoading`, and a client `RegionLoadError({label}: {label: string})` that uses existing `router.refresh()` for retry. Each fallback is accessible and occupies the existing h-40/h-64/four h-28 cards/h-80 region layout. Do not put an aggregate region promise in the context.

- [ ] **Step 1: Add delayed-data behavior tests.** Use `Promise.withResolvers` fixtures and mock only data services/client leaf components. Test named `clock resolves while secondary regions and search params are pending`: invoke the actual `ClockRegion`, release context/active period, and assert the returned widget receives the known active period/name/format while all other read promises remain pending. Test named `page returns independent boundaries without resolving secondary data`: resolve authorized context and inspect the returned React tree for four sibling Suspense boundaries containing the actual async regions. Assert date promise goes only to timeline. These unit tests exercise component functions/composition; they do not claim to render an RSC stream.

```ts
expect(clockElement.props.activeWorkPeriod).toEqual(activePeriod);
expect(clockElement.props.timeFormat).toBe('24h');
expect(secondarySettled).toBe(false);
expect(timelineResult.props.result).toEqual(expectedSerializedTimeline);
```

Add rejection cases for active period, history, timeline, summary, and unknown auth. Unknown clock status returns error UI with no widget; no employee returns the existing `NoEmployeeError`; auth null follows session-expired redirect. Test `unstable_rethrow` before any generic fallback. Exercise retry click in jsdom and assert one refresh without enabling clock actions locally.

- [ ] **Step 2: Run to observe failure.** `pnpm exec vitest run --project unit 'src/app/[locale]/(app)/time-tracking/regions.test.tsx'`. Expected: missing regions/old aggregate dependency fail.
- [ ] **Step 3: Implement composition.** Page exports the same `searchParams` contract and retains outer identity Suspense. Content resolves authorized context, denies missing auth with the same locale/callback session-expired redirect as the app layout, handles no employee, and returns sibling boundaries in the current order. Clock awaits only its active-period read and existing common employee label when needed. Timeline awaits/normalizes date locally. Wrap each region's ordinary data failure in inline retry UI, keeping structured timeline failures and balance-null semantics. Preserve framework errors with `unstable_rethrow`. Keep shared spacing/padding unchanged. Retire `getTimeTrackingPageData` once no caller remains; retain/re-export the search-param type or move it to `regions.tsx` and update all imports in the same commit.
- [ ] **Step 4: Verify tests and runtime.** Rerun step 2 and existing tests for clock widget, timeline, summary, time entries, canonical actions, and public action surface. In a disposable production-mode fixture process, deliberately delay secondary data at the data-service seam using test-process-only stubs/instrumentation; verify actual browser clock content arrives before those services finish, then completes when released. Keep any delay harness outside the production router and remove it before delivery. This real stream check is required in addition to unit composition tests. Check ordinary navigation, date navigation, back/forward, and fixture clock mutation/refresh; there must be no stale enabled clock or new console/hydration/prerender errors. Capture layout shifts and the stage-2 timings. If configuration is unavailable, document these runtime gates as pending.
- [ ] **Step 5: Commit and deliver change 2.** `git commit -m 'perf: stream independent time tracking regions'`. Run shared gates and Next development/production runtime verification before marking the ticket complete.
