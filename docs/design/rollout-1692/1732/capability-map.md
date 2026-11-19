# R049 pre-edit capability inventory

Pinned source: d447420ec044e4cd7cdd45eb6af4ad9ff91360f3 (verified product ancestor 9f839b78f109b1f3eea1c40b959e76ae99efba3b; H1 26d1d8fd016d6daa0c9fe71e0f671571dd45c211). #1732 ownership verified OPEN/KaiSoellch/startcomment 6899946798.

| Existing capability | Owner/default/authority | Refreshed location |
| --- | --- | --- |
| Personnel files back link, locale navigation | navigation Link /personnel-files | page header scope |
| One Payslip batches h1, streamed named loading | admitted server route; Suspense/LoadingRegion | PageHeader + existing loading |
| Month 01–12, year four digits | TanStack; server loadOrganizationDay(systemClock), not viewer timezone | compact start form; same calendar defaults |
| Shared default / HR-only visibility and explanation | document labels; createPayslipBatch validates | same form, explicit later confirmation/notification consequence |
| Start batch -> own batch URL | startPayslipBatchAction -> canonical createPayslipBatch | same action + displayed actor/org comparison guard |
| Field validation, pending disabled, retained input / toast failure | TanStack / sonner | preserve plus inline announced error/retry; no invented success |
| Own latest 20 batches, newest first | listOwnPayslipBatches(access), original limit 20 | complete returned history with explicit empty state |
| Pay period locale month/year, file count, open/confirmed | store summary; Temporal plain date | aligned history rows, every field retained phone+wide |
| Deep links /personnel-files/payslip-batches/:id | ownBatchCondition actor+org; canRunPayslipBatches | same authorized links |
| Owner/admin or payslip category-scoped officer | loadCurrentPersonnelFileAccess / canRunPayslipBatches | independently guarded route and action; manager/payroll alone insufficient |
| Module off/no access/unauthenticated | safe not-found | unchanged; scope gate hides stale RSC arrival |
| Confirmation/matching/upload/partial failure/notification | later batch workspace/domain owners | unchanged; start saves only empty batch |
| Theme/text/sidebar prefs and shortcuts/refresh/mobile drawer | existing app shell, no page persisted preferences | unchanged; refresh must retain same-scope form draft |

Preapproved public seams: assembled route/form controls and external action boundary; existing real PG actions/store readers; actual disposable browser actions. Vertical slices cover inline failure + retry, scope/lifetime (queued validation and A-B-A/Activity), expected actor/org rejection with both-org authority, history fields/links/empty state. No tests against private helpers or class strings. No shared document/request/retention files edited.

Design: restrained operational form leading an aligned record surface, existing font/blue/theme tokens and spacing; no new motion. DFII 4+5+5+5-4=15. Compact inline start is the explicit approved route brief exception to ordinary edit panels.
