# Mobile fixes and Chrome verification

Date: 16 October 2026. Ticket: [#1275](https://github.com/Umami-Creative-GmbH/z8/issues/1275). Branch: `ai/1275-mobile-usability-fixes`.

This implements the 13 primary findings and 15 additional list findings from the [mobile audit](./2026-10-16-mobile-views.md). Verification used the user's authenticated Chrome session and the running worktree at `Y:/Codex/Worktrees/faa6/z8` through `https://z8.localhost`.

## Primary findings

| Audit ID | Change | Chrome result |
| --- | --- | --- |
| M01 | Employee rows become labeled details on phones. | 16 rows; table and scroller both 306 px at 390 px, and 226 px at 320 px. Row actions stay with the details. |
| M02 | Time history uses the same phone layout; header actions stack. | 10 work periods; table and scroller both 296 px. |
| M03 | Templates move above the calendar below the desktop breakpoint; the responsive scheduler has a Day view. | Calendar now 348 px at 390 px and 278 px at 320 px, versus approximately 86 px and 14 px before. Desktop at 1440 px opens Week with an 840 px calendar beside templates. |
| M04 | Cards and chart containers can shrink; analytics detail tables stack. | All five analytics routes checked with data at 390 px. Charts fit their 298 px containers. Overview also fits 228 px chart containers at 320 px. |
| M05 | Shared tab lists provide contained horizontal scrolling. | At 320 px, the 691 px provider row scrolls inside 288 px. History was opened successfully. |
| M06 | Template grids, list text, fieldsets and the rich editor canvas can shrink. Long template lists scroll within a compact selector on phones. | Organization and system template pages have no overflowing cards at 390 px. Organization editor also checked visually at 320 px; body canvas is 210 px. |
| M07 | Vacation tables stack, toolbars wrap and nested tabs scroll. | Policy and proration rows fit. Holidays → Categories is reachable; its empty state fits. |
| M08 | Notification header actions wrap below the title; body text gets more room and actions sit below it. | At 320 px, Settings ends at x=236, previously x=381. Populated titles/previews are readable without word-by-word wrapping. |
| M09 | Calendar Week has a contained horizontal scroller with readable day columns. | Scrolled to the end and visually confirmed Sunday. Grid is intentionally 672 px within a 356 px scroller. |
| M10 | Import progress connectors shrink on phones. | All seven steps fit at 320 px; step 7 ends at x=296. No credentials were entered. |
| M11 | Shared card and grid constraints allow platform settings to shrink. | Inputs and textarea end at x=331 inside the mobile content. No overflowing cards. |
| M12 | Readiness cards can shrink; affected employees use labeled rows. | 16 employees, table and scroller both 298 px. No overflowing cards. |
| M13 | Location title and actions stack and wrap. | Downtown Branch detail checked; Delete ends at x=247, previously x=473. |

The shared tab/link composition also fixes D01: analytics tabs now retain their labels and render as anchors instead of empty controls or nested links inside buttons. Verified navigation through all five analytics tabs in Chrome. Server children are unwrapped with React.Children.toArray before composition.

## Additional list coverage

Each available populated view was revisited in Chrome at 390 px. Every table below now matches its scroller width, with row details and actions in a two-column phone layout. Sorting and selection controls remain available in the header; original actions remain mounted once.

| ID | Route / view | Populated rows | Table / scroller width |
| --- | --- | --- | --- |
| T01 | Team absences | 16 | 346 / 346 px |
| T02 | Team driving details | 64 | 346 / 346 px |
| T03 | Approvals: absences and time corrections | 4 each | 296 / 296 px |
| T04 | Project reports, after Generate Report | 6 | 296 / 296 px |
| T05 | Audit activity | 5 | 298 / 298 px |
| T06 | Change policies | 2 | 346 / 346 px |
| T07 | Work policies | 1 | 356 / 356 px |
| T08 | Locations | 3 | 346 / 346 px |
| T09 | Work categories / category sets | 8 / 2 | 298 / 298 and 296 / 296 px |
| T10 | Project settings | 6 | 298 / 298 px |
| T11 | Employee vacation allowances | 16 | 296 / 296 px |
| T12 | Platform organizations | 1 | 340 / 340 px |
| T13 | Platform users | 16 | 330 / 330 px |
| T14 | Worker queue scheduled jobs | 39 | 250 / 250 px |
| T15 | Licenses | 123 | 294 / 294 px |

Desktop regression checks at 1440 px confirmed normal employee table layout (eight cells per row, table-row display), scheduler Week with sidebar, and contained Work Hours charts/table. Phone table layout applies below 640 px and is opt-in; the vehicle month matrix retains its scrolling layout.

## Checks and evidence

- Focused Vitest run: **68 tests passed across 14 files**. Covers table labels/ref/action identity, tab links, charts, notifications, time history, approvals, project reports, licenses, readiness, categories and email editor behavior.
- Full `pnpm run typecheck` passed.
- Targeted Biome check for shared table, tabs, CSS and DataTable passed.
- React Doctor scanned 49 changed source files and reported no issues.
- [Structured Chrome measurements](./mobile-fixes-2026-10-16-measurements.json). Loading shells and samples taken before hydration are excluded from the recorded settled samples.
- Screenshots: [Scheduling 320](./images/mobile-2026-10-16/fixed/scheduling-320.png), [Scheduling desktop](./images/mobile-2026-10-16/fixed/scheduling-desktop.png), [Payroll History 320](./images/mobile-2026-10-16/fixed/payroll-export-320.png), [Notifications 320](./images/mobile-2026-10-16/fixed/notifications-320.png), [Email editor 320](./images/mobile-2026-10-16/fixed/email-editor-320.png), [Calendar Sunday](./images/mobile-2026-10-16/fixed/calendar-week-390.png), [Location detail](./images/mobile-2026-10-16/fixed/location-detail-390.png), [Employees desktop](./images/mobile-2026-10-16/fixed/employees-desktop.png).

## Limits

This verifies the audit's available states, rather than every role, locale or dialog. Chrome used CSS viewport overrides, not a real touch device. Holiday categories were empty; worker queue error/history states were not populated. Personnel Files, Billable Time, payroll/billing restrictions and token-dependent routes retain the original audit's coverage limits. No organization settings, approvals, notifications, credentials or feature flags were changed during verification; project report generation only read data. The separate Work Diagnostics database-query error (D02) is outside this layout change.

Temporary viewport overrides were restored after verification.
