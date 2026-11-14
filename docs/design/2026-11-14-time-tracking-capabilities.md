# Time-tracking capability inventory

Implementation of #1689. Read before changing the route; compare again at verification.

| Capability / owner | Refreshed location | Preservation boundary |
| --- | --- | --- |
| `getTimeTrackingRenderContext`, independent streamed regions | Same route and Suspense regions | Session, MFA, active organization and employee admission stay on the server. Region failures remain isolated with retry. |
| `useClockInOutWidget` / shared clock store | Compact action band | Same clock-in/out, synchronized elapsed work, optimistic state, pending feedback, workplace preference, offline capture and command recovery. |
| Clock booking choices | Band middle | All workplace choices and conditional vehicle readings stay available. |
| Break, quick break, compliance, reminders, driving authorization | Band and its operational notices | Resume/end-day, rest enforcement, exception request, offline limitations and reminders retain existing handlers. |
| Post-clock-out notes and timezone mismatch dialog | Existing band disclosure/dialog | Preserve notes draft/save/skip, update saved timezone/continue once/cancel and validation. |
| `readTimeKpis`, live KPI basis, work balance | Single aligned summary strip | Authoritative worked/required durations, trends, surcharge notes, limits, adjustment history and pending balance stay intact. |
| `getWorkdayTimelineData` | Week/day context in main column | Date links open the actual selected day, preserving shifts, breaks, absences, warnings, work links and blocker focus targets. Calendar uses the same `date` route parameter. |
| `TimeEntriesTable` / `getTimeEntriesColumns` | Daily grouped record | Retain original column rendering, captured endpoint offsets, notes, surcharge/compliance indicators, missing tasks/driving details, billability, approval and correction dialogs. Retain an all-entries table view with the same columns/actions; grouped day tables explicitly render every fetched row rather than silently stopping at ten. |
| Manual time dialog | Action band access plus record header | Existing TanStack form, manager requirements, timezone and recovery behavior. |
| Calendar destination | Record header, contextual month selector | Existing full calendar route remains reachable. |
| `PeriodSubmissionsCard`, `PeriodBlockerFocus`, driving notice | Below primary record / operational notices | Submission, recall, resolution links and focus arrival remain available with their authorized server reads. |
| Workplace policy | Supporting column | Reuse existing authorized employee policy read; never invent allowance values. |
| Theme, enlarged fonts, keyboard | All regions | Theme tokens, wrapping labels, visible focus, semantic navigation and touch targets. |

The original personal history supplied the current employee-local week and had no route-specific export/filter/bulk toolbar or pagination controls. The shared table had an internal ten-row page model. Both refreshed presentations explicitly render all fetched rows. Browsing a day now selects its employee-local week for history too; Temporal computes the UTC query boundaries across DST. The full calendar remains the destination for its wider filtering/export/bulk workflows.

## Time semantics and target discrepancy

Time-tracking targets come from `read-time-kpis.ts` → `loadDailyWorkRequirementsForEmployee` → `summarizeTimeKpis`. They sum the employee's actual work-policy requirements for the calendar month, using the employee timezone and policy effective dates. This is distinct from the dashboard's legacy normalized month estimate (investigated in the dashboard inventory). The visual refactor preserves these sources, UTC duration semantics and separately captured endpoint offsets. It never derives durations from displayed labels or copies prototype fixtures.

## Verification record

Source inventory completed before implementation. Scoped clock, break, KPI, timeline, history, captured-offset, date-navigation and region regressions pass (95 tests across nine suites). New coverage checks cross-timezone grouping without mutating endpoint metadata, retaining more than ten records, active/incomplete distinctions, Sunday/Monday preferences, month/year navigation and selected-week query boundaries across DST. Biome check passes for all changed time-tracking source/tests. Runtime results and captures are recorded in the combined implementation report; database integration remains dependent on the local verification environment. New translation keys use static English defaults; Tolgee synchronization requires the configured service credentials.
