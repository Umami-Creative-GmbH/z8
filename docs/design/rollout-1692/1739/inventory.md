# R157 pre-edit capability inventory

Prepared branch `feat/managed-team-directory` was clean at
`58ea18603a936d102f0625e3303f4c05689a9961`. Both the directly supplied product
`ca6f607d683c69ee47e7558fae78b1dcd1b53914` and H1
`26d1d8fd016d6daa0c9fe71e0f671571dd45c211` are ancestors. GitHub CLI readback
confirmed #1739 OPEN, KaiSoellch, start comment 6904215822 before source investigation.

Historical comparison: approved-spec source `38a16f7cb605f0929743de5e74b57332f471ac00`
against prepared metadata `58ea18603`; see `historical-consumer.diff`. No historical
evidence verifier is run. Runtime before/after will use the same generated fixture.

| Capability | Existing owner / behavior | Refreshed location |
| --- | --- | --- |
| Admission | Current roster employee in active session org; manager/admin employee role; other roles redirect home, missing employee gets NoEmployeeError | Same server page guards; page title on safe arrivals |
| Scope | getManagedEmployees: self plus direct employeeManagers relationships in active org; admin is not broadened here | Same action, no domain change |
| Count | Number returned by scoped action, includes self and requested former reports | Heading scope, including zero |
| Identity | User ID, employee ID, name, email, image/seed; first/last/pronouns remain payload metadata | Card identity and table identity |
| Position/team/role | Position, primary team name, employee base role | Card details and table columns; explicit employee role also in cards |
| Primary manager / You | Relationship isPrimary; current actor flag | Existing indicators in both views |
| Current/former | Canonical roster query/formerSince marker; requested by exact former=1 URL | Switch always reachable; badges in both views |
| Activity | Shared polling useEmployeeClockStatuses, UserAvatar status, captured-offset EmployeeActivityText, break metadata | Retain unchanged owners/props; no timezone calculations |
| Balance | Authoritative work-balance payload; signed format; missing payload distinct from zero | Named balance history control in each record |
| History | Shared read-only BalanceAdjustmentHistoryDialog and its independently guarded action | Existing balance badge destination; no mutation form added |
| Employee destination | /settings/employees/:id, independent destination guard | Same link, visible keyboard focus; no inferred document/payslip/officer links |
| Settings entry | /settings/employees from existing empty state | Retain empty-state link |
| Search | Immediate local name/email/position/team substring match, case insensitive | Visible labeled search; clear-search no-match recovery |
| Former switch | router.replace /team?former=1 or /team, no scroll; React transition disables duplicates | Retain URL owner and pending control |
| View | Local cards/table state, default cards; no saved-view storage | Both controls available on phone; no invented persistence |
| Sorting | Balance ascending/descending/none, unknown currently compares as zero; other columns unsorted | Retain exact sort formula and accessible direction |
| Paging | Local table page size 10, Previous/Next and range; cards unpaginated | Retain table controls, responsive wrapping |
| Empty / no match | Separate empty scope and filtered no-match; empty currently hides toolbar | Keep toolbar and truthful distinct feedback |
| Loading / error / retry | Shell title; page error lacks Retry; no directory loading file | Route-owned loading title and recoverable error, exact heading adoption |
| Refresh / shell | Existing shell combined refresh; session/org/Activity behavior and preferences owned by shell/providers | Preserve shared consumers; test route state without remount keys |
| Themes/text/navigation | Global existing theme, font size, sidebar/drawer and keyboard owners | Existing tokens/font; inspect phone, desktop, wide, saved 18px |

Design intent: a manager comparing supervised colleagues needs a calm directory,
with scope above a compact control band and identity/activity/balance readable at
the record. Existing app font and friendly blue tokens, fine borders, 4px spacing
rhythm, restrained radii, no decorative motion. DFII 12 (3+5+5+4−5).

Preapproved public test seams: rendered TeamMembersList controls/records/history;
async TeamPage safe/error arrivals; appPageOwnsHeading exact route adoption;
existing getManagedEmployees PostgreSQL seam. Tests do not replace domain authority.
No editable form or mutation is introduced, so queued form validation / late mutation
success is not a new directory seam. Shared history/session faults require a concrete
public repro and root coordination rather than editing shared hooks.

Known boundaries: raw isActive versus departure-cutoff divergence remains a source
gap; do not reclassify here. Off-limits reports, scheduling, shared employee hooks,
cards/forms and lifecycle owners are not edited. Only a directly supplied verified
checkpoint may be merged; otherwise final checks stay pinned to supplied metadata.
