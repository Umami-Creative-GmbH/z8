# R065 pre-edit capability inventory

Source: 58ea18603a936d102f0625e3303f4c05689a9961; directly verified product ca6f607d683c69ee47e7558fae78b1dcd1b53914; H1 26d1d8fd016d6daa0c9fe71e0f671571dd45c211. Clean dedicated feat/scheduling-planner checked before source investigation. #1738 OPEN / KaiSoellch / start comment 6904191066 read back with gh. CONTEXT-MAP.md absent; GLOSSARY-MAP.md is the existing context map.

## Owners and complete capability mapping

| Capability / existing fields and states | Owner / admission | Refreshed location / preservation |
| --- | --- | --- |
| Employee lookup, active org, timezone, onboarding redirect | page/getAuthContext + org-scoped read | PageHeader and scope; same guards |
| employeeId/date deep links; invalid/repeated query ignored | parseSchedulerFocus; planner employee filter only | Same URL/initial range; Show all notice retained |
| Planner day/week/month, today/previous/next/calendar date | Schedule-X + dateRange, saved weekStartDay | Main calendar, locally scrollable; non-gesture record list added |
| Published, draft and open; employee identity, template, place, times, notes, color | getShifts + shiftToEvent (no reclassification) | Calendar and accessible record list; same domain labels |
| Template name/color/times/duration/isActive + drag data | getShiftTemplates; planner | Template rail retained; explicit template button and Create Shift restore advertised creation path |
| Create/edit/delete; delete confirmation/cancel; panel focus/Escape | ShiftDialog + TanStack form + ActionPanel | Existing contextual panel, same payload/actions |
| Date/template/subarea/employee/start/end/notes/color/skillOverrideReason | useShiftDialogForm + ShiftDialogSections | Same fields, defaults, current-roster picker, template autofill and scoped skill validation |
| Advisory staffing, rank/reasons, blocked/ineligible, pending/error/empty | useStaffingSuggestions and authoritative staffing action | Same suggestions panel; no automatic assignment |
| Missing/expired required/preferred skill + certificate-on-file; reason refusal context | skill validation and skill-override domain | Same warning/reason; no new formulas or permission |
| Drag update/refusal/reset | upsertShift via useShiftSchedulerData | Existing plugin, same wall-time conversion and rollback |
| Coverage overlay toggle, coverage summary/gaps/details/config link | useCoverageHeatmap + settings coverage action | Supporting planner region preserved; no calculation changes |
| Compliance findings/type counts; absent/zero distinction | getScheduleComplianceSummary | Same banner; read failures receive retry, no invented all-clear |
| Draft count/publish/warning tooltip, pending, evaluation fingerprint acknowledgment and re-evaluation | useShiftPublishFlow/publishShifts | Same existing protocol and confirm dialog; button alongside planner actions |
| Pickup/swap pending review, assignee/reason/approve/reject/pending/refusal | ShiftRequestsReview and existing shift request actions | Same planner review panel; employee pickup/swap destinations elsewhere unchanged |
| Employee own published calendar/week/month, phone weekly agenda/day highlight/swipe/buttons, overnight/place/notes/details/close | EmployeeShiftSchedule + EmployeeShiftAgenda + getShifts authority | Same phone agenda and full details; retry retains usable shifts |
| Loading/error/refetch/retained data/Retry | TanStack query owners | Truthful region feedback, retain existing data |
| Org/actor A-B-A and retained Activity sessions | shell auth context + route scheduler identity | Key schedule by org/actor/role/focus so old targets are not current |
| Themes/font size/week start/sidebar/navigation/locale/refresh | existing preference/shell/Tolgee owners | No new persistence model or reset; unchanged shared utilities |
| Route h1 including safe loading | PageHeader/LoadingRegion; exact heading opt-in | One page heading, exact /scheduling additive opt-in; no descendant adoption |

## Public seams preapproved by spec Testing Decisions

Render SchedulingPage and its loading shell, real TemplateSidebar, real scheduler and ShiftDialog with action transport boundaries; DOM-visible controls, payloads and retained input. Retain existing publish handshake / skill / staffing / org-scope regressions. Real disposable PostgreSQL and normal auth runtime supplement component tests. No source-string proof of user behavior. No shared domain change is authorized without a public red and root coordination.

## Design decision

Calm operational planning: planners place and publish future work; employees read their published week. Organization-local days, shifts, open staffing, templates, skills and publish warnings define the vocabulary. Existing app font, primary tech blue, draft neutral, published blue, open amber, semantic warnings and fine borders remain. Planner calendar leads, with compact action row and supporting templates; record buttons provide keyboard alternatives. Existing spacing scale, restrained surfaces and no decorative motion. DFII 12 (3+5+5+4-5). No rebrand, new font, new policy or recorded-work writer.

## Known inherited gaps to verify, not silently claim

Template drag callback is ignored; no Create Shift visible. Schedule loading errors lack planner Retry; employee phone hides retained data after a refetch failure. Page/shell duplicate heading until exact opt-in. No new employee pickup/swap control will be invented: existing paths remain in their owning consumers. Full generation, Tolgee/provider/device/physical zoom/global transition acceptance remains incomplete unless explicitly evidenced.
