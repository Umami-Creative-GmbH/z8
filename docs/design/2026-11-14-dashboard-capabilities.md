# Dashboard capability inventory

Implementation ticket: #1689. Recorded before dashboard edits.

| Existing capability and owner | Refreshed location and preservation |
| --- | --- |
| ServerSectionCards / dashboard-reads: independent authorized server reads, streamed errors and fallbacks | Same slots and Suspense boundaries in the new regions; no replacement client waterfall. |
| useWidgetOrder: organization/user scope, eligible widgets, hidden widgets, optimistic saves, rollback and reset | Same hook and customization menu. Canonical layouts use the approved regions. A saved noncanonical order uses the ordered layout, preserving every position; reordering in customization selects that layout automatically. No saved preferences are rewritten. |
| Manager Today: four counts, all-clear, error/retry, /today | Main attention region; real briefing link and all counts retained. |
| Pending Approvals: absence and correction lists, counts, urgency, inbox | Attention region, retaining the real lists/actions. |
| Who's Out Today: approved absence records, return information, calendar | Attention region. Empty means no recorded absence, never inferred presence. |
| Managed Employees: scoped manager links, live presence polling, real avatars, position/email/team, captured-offset activity, breaks, employee links, full-team navigation | One aligned team record surface in the main column. Phone layout keeps details within the person's row. |
| Quick Stats: weekly/monthly actual, expected, expected-to-date status; errors/refetch | Aligned summary strip with the same calculations. Cached all-time balance uses the existing work-balance reader and remains distinct from a period variance. |
| Organization: current roster count, teams, average weekly hours, teams/employees links | Summary region, retaining every count and destination. |
| Shared clock state and actions | Personal-day context uses the existing shared clock query and links to the actual time-tracking route. Its independently streamed daily actual and target reuse `readTimeKpis`, the employee timezone, and `useLiveWorkNow`. A changed active clock triggers an RSC refresh and withholds a mismatched total until the authoritative replacement arrives. Header operational controls remain authoritative. Active-session time is labeled as a session, not a full-day total. |
| Vacation Balance: resolved/missing policy, remaining/used/pending/previously taken/carryover and expiry warnings | Supporting column; preserve all configuration and calculation states; add direct link to the existing absence request workflow. |
| Upcoming Time Off and Recently Approved: previews, full history/calendar links, date formatting, scope | Supporting column. Full recent history remains accessible through disclosure and the real inbox link. |
| Upcoming Shifts, Covering For: employee schedule and cover duties | Main working context below attention/team. |
| Work Location: policy, effective dates, updates/actions/errors | Supporting utilities disclosure. |
| Birthdays and Hydration: visibility/deferred loading, reminders, water intake, streaks | Utilities disclosure with original deferred slot behavior and controls. |
| WidgetCard refresh and errors, global view refresh | Refresh remains keyboard reachable at each module, visually restrained; errors retain retry. |
| All-hidden / restricted / loading | Existing empty reset, widget eligibility, reader authorization and fallbacks retained. No zero substituted for unavailable data. |

## Monthly target discrepancy

The legacy dashboard's `quick-stats-calculations.ts` computes a period target as weekly hours multiplied by elapsed calendar milliseconds / seven days, then subtracts excluded absence/holiday dates. For a 40-hour week over November's 30 days, that yields about 171.4 hours. Time tracking's `read-time-kpis.ts` sums the employee's daily work-policy requirements: a 21-weekday month at eight hours yields 168 hours. These are different production calculation paths, not a typography or rounding problem.

The dashboard's adopted-tracking path (`quick-stats-tracking.ts`) already sums shared daily requirements in the employee's tracking timezone. This refresh keeps the legacy/adopted distinction, requirement sources, canonical UTC actual durations and captured-offset activity. It does not redefine expected hours to force fixture agreement.

## Verification boundary

Capability and preference regression tests cover complete region allocation and customized ordering. New personal-day checks cover authoritative requirements, unknown data, break capture context, shared-clock refresh and retry. Existing widget suites remain the behavior checks for authorization, failures, deferred loading and real actions. The complete dashboard/section-cards unit group passed (156 checks before the monthly-target regression addition). Authenticated role/state screenshots and real mutations require the running application and its configured environment; final evidence records the actual checks performed.
