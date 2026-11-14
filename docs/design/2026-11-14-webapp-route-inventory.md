# Webapp route inventory - draft discovery, 14 November 2026

This is a source-based inventory for draft spec #1692, not an implementation plan or authorization audit. It records the page templates present in this checkout and the actors suggested by their existing shells, page guards, rendered components and settings navigation. Roles and capabilities are observations, not proposed policy.

## Counting and normalization

- Scope: user-facing pages in `apps/webapp/src/app`, including auth, setup, onboarding, public/shared, settings and platform administration. API routes and separate docs/marketing/desktop applications are excluded.
- A template is an exact `page.tsx` file. `[locale]` and route groups are removed from its normalized URL; dynamic segments remain. Locales, record IDs, query strings, tabs and role variants do not create extra rows.
- All 172 page templates are `page.tsx` files beneath `[locale]`. There are no `page.ts`, `page.js`, `page.jsx`, `page.md` or `page.mdx` variants, duplicate normalized templates, parallel-route pages, intercepting-route pages or page files inside private folders.
- A persistent page renders its own screen for at least one supported state. A page that sometimes redirects because of authentication, configuration, role, record validity or query selection remains a persistent page.
- A redirect-only alias never renders a destination screen of its own. Some aliases render a transient Suspense skeleton; this does not make them separate interactive screens.
- `/` and `/time-tracking` are the already refreshed reference routes identified by the approved dashboard/time-tracking direction. They remain in the inventory; this document does not decide whether they receive new implementation tickets.

| Shell/group | Persistent pages | Redirect-only templates | Total templates |
| --- | ---: | ---: | ---: |
| Authenticated app, excluding settings | 52 | 0 | 52 |
| Authenticated settings | 68 | 19 | 87 |
| Auth/public shell | 10 | 0 | 10 |
| Platform-admin shell | 9 | 0 | 9 |
| Onboarding shell | 9 | 0 | 9 |
| Initial setup shell | 1 | 0 | 1 |
| Shared-report shell | 1 | 0 | 1 |
| Standalone initialization, kiosk and MFA | 3 | 0 | 3 |
| **Total** | **153** | **19** | **172** |

Of the 153 persistent templates, 2 are refreshed references and 151 are other page templates. The user approved one page ticket per persistent template (153 page tickets), with the 19 redirect aliases covered by destination-page tickets. Additional shared-pattern and grouping issues are separate from that page count. See the [grilling decisions](2026-11-14-webapp-ui-ux-grilling.md).

## Shell and access evidence

- Common locale shell: `apps/webapp/src/app/[locale]/layout.tsx` provides translations, light/dark themes, font-size preference, query state, toasts, progress and deployment/service-worker prompts.
- App shell: `apps/webapp/src/app/[locale]/(app)/app-layout-content.tsx` enforces session, MFA/SSO and billing recovery, then renders sidebar/header, banners, organization settings and user preferences. It is shared by app and settings rows.
- Settings shell: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx` adds settings navigation and breadcrumbs. `apps/webapp/src/components/settings/settings-config.ts` records navigation tiers and feature visibility; actual pages/actions still enforce access. Root ADR `docs/adr/0002-settings-actions-authorize-by-settings-access-not-casl.md` distinguishes member, scoped manager, org admin and owner action access.
- Analytics nested shell: `apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx` renders analytics navigation and admits manager/admin employee roles.
- Auth shell: `apps/webapp/src/app/[locale]/(auth)/layout.tsx` renders the domain-aware authentication background, controls and footer. `apps/webapp/src/proxy.ts` declares public routes and token-shared report handling.
- Platform-admin shell: `apps/webapp/src/app/[locale]/(admin)/admin-layout-content.tsx` requires `session.user.role === "admin"` and provides a separate admin header/navigation. This is distinct from organization admin access.
- Onboarding shell: `apps/webapp/src/app/[locale]/onboarding/layout.tsx` renders the shared onboarding background, controls and footer. Administrative setup steps contain client step-access checks; personal steps serve the onboarding user.
- Setup and shared-report shells have their own layouts. Kiosk sits outside the authenticated shell and uses a device token; `/init` and `/mfa` also sit outside the app shell.
- Domain vocabulary was checked against `GLOSSARY-MAP.md`, the linked context documents and root ADRs. Root ADR `docs/adr/0001-store-apps-are-a-thin-shell-around-the-web-app.md` means these web screens also reach the mobile store shell; it does not add separate route templates.

## Persistent page templates

Inventory IDs `R001`-`R172` are assigned once to the normalized templates in this draft; retain them when arranging tickets. Within each table, the source column is relative to the stated source root. Joining that root and the listed suffix identifies the exact page file. The named component/guard is additional observed evidence for the purpose/access description.

### Authenticated app (52)

Source root: `apps/webapp/src/app/[locale]/(app)`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R002` | `/absences` | Personal absence calendar/list and vacation balance | Employee | `absences/page.tsx`; `AbsencesPage`; `getCurrentEmployee` |
| `R005` | `/analytics/overtime-burn-down` | Overtime trend and employee breakdown | Manager or workforce admin | `analytics/overtime-burn-down/page.tsx`; `OvertimeBurnDownPage` |
| `R004` | `/analytics` | Analytics overview and approval bottlenecks | Manager or workforce admin | `analytics/page.tsx`; `AnalyticsOverviewPage` |
| `R006` | `/analytics/team-performance` | Team performance metrics and comparisons | Manager or workforce admin | `analytics/team-performance/page.tsx`; `TeamPerformancePage` |
| `R007` | `/analytics/vacation-trends` | Vacation utilization, balances and seasonal trends | Manager or workforce admin | `analytics/vacation-trends/page.tsx`; `VacationTrendsPage` |
| `R008` | `/analytics/work-hours` | Work hours, variance and employee distribution | Manager or workforce admin | `analytics/work-hours/page.tsx`; `WorkHoursPage` |
| `R010` | `/approvals/deputy-decisions/[absenceId]` | Decisions made as deputy for an absence | Authorized employee with deputy-decision visibility | `approvals/deputy-decisions/[absenceId]/page.tsx`; `DeputyDecisionsPage`; `notFound` |
| `R011` | `/approvals/inbox` | Unified approval inbox, detail panels and bulk decisions | Authorized approver; per-item capabilities | `approvals/inbox/page.tsx`; `ApprovalInboxPage` |
| `R009` | `/approvals` | Legacy absence and time-correction approval queues | Manager or workforce admin | `approvals/page.tsx`; `ApprovalsPage`; `getCurrentEmployee` |
| `R012` | `/approvals/review/[organizationId]/[kind]/[id]` | Approval deep-link arrival and review outcome | Signed-in recipient; target and organization authorization | `approvals/review/[organizationId]/[kind]/[id]/page.tsx`; `ApprovalReviewPage`; `resolveApprovalReviewArrival` |
| `R013` | `/billing/suspended` | Subscription access recovery and billing contact guidance | Organization member; billing managers receive recovery actions | `billing/suspended/page.tsx`; `SuspendedBillingPage` |
| `R015` | `/calendar/[employeeId]` | Calendar with a selected employee | Employee; shared calendar scope and selected-employee authorization | `calendar/[employeeId]/page.tsx`; `CalendarEmployeePage` |
| `R014` | `/calendar` | Personal and organization work/absence calendar | Employee; available calendar scope | `calendar/page.tsx`; `CalendarPage` |
| `R016` | `/compliance` | Compliance command center | Organization admin | `compliance/page.tsx`; `CompliancePage`; `requireOrgAdminSettingsAccess` |
| `R018` | `/driving-licence/checks/[employee]` | Driving licence check for a selected employee | Authorized check reader/verifier | `driving-licence/checks/[employee]/page.tsx`; `DrivingLicenceCheckPage`; `requireDrivingLicenceCheckPage` |
| `R017` | `/driving-licence` | Personal driving licence, verifier worklist and operational status | Driver, verifier or operational reader; capability-based tabs | `driving-licence/page.tsx`; `DrivingLicencePage`; `requireDrivingLicencePage` |
| `R020` | `/equipment/assignments/[assignmentId]` | Equipment assignment detail and return lifecycle | Authorized equipment reader/operator for assignment | `equipment/assignments/[assignmentId]/page.tsx`; `EquipmentAssignmentPage`; `notFound` |
| `R021` | `/equipment/employees/[employeeId]` | Equipment held by a selected employee | Authorized equipment reader/operator for employee | `equipment/employees/[employeeId]/page.tsx`; `EquipmentEmployeePage`; `notFound` |
| `R019` | `/equipment` | Equipment assignment overview and filters | Authorized equipment staff within their scope | `equipment/page.tsx`; `EquipmentPage`; `notFound` |
| `R028` | `/my-documents` | Own shared personnel documents and document requests | Employee with personnel-file self-service access | `my-documents/page.tsx`; `MyDocumentsPage`; `notFound` |
| `R029` | `/my-equipment` | Personal equipment and return obligations | Employee with equipment self-service access | `my-equipment/page.tsx`; `PersonalEquipmentPage`; `notFound` |
| `R030` | `/my-requests` | Own request history and request state | Employee | `my-requests/page.tsx`; `MyRequestsPage` |
| `R031` | `/notifications` | In-app notifications inbox | Signed-in user | `notifications/page.tsx`; `NotificationsPage`; `requireUser` |
| `R041` | `/organization` | Organization explorer | Organization reader; admin receives management actions | `organization/page.tsx`; `OrganizationPage` |
| `R001` | `/` | Dashboard: current work, summaries and operational entry points **Refreshed reference.** | Organization member; onboarding and invitation arrival gates | `page.tsx`; `Page` |
| `R042` | `/payroll` | Payroll workspace, readiness and export preparation | Authorized payroll reader/officer; action-defined scope | `payroll/page.tsx`; `PayrollPage` |
| `R044` | `/payroll/work-balances/[employeeId]` | Employee work balance and overtime payouts | Payroll-access grant holder covering employee | `payroll/work-balances/[employeeId]/page.tsx`; `PayrollWorkBalancePage`; `notFound` |
| `R043` | `/payroll/work-balances` | Work balance directory and opening balance upload | Active payroll-access grant holder | `payroll/work-balances/page.tsx`; `PayrollWorkBalancesPage`; `notFound` |
| `R046` | `/personnel-files/[employeeId]` | Employee personnel file, requests and sick-leave records | Officer with employee/category capability | `personnel-files/[employeeId]/page.tsx`; `PersonnelFilePage`; `notFound` |
| `R047` | `/personnel-files/document-requests` | Organization document request overview and bulk requests | Officer with document-request management capability | `personnel-files/document-requests/page.tsx`; `DocumentRequestsPage`; `notFound` |
| `R048` | `/personnel-files/due-for-deletion` | Documents due for deletion | Officer who manages documents in scope | `personnel-files/due-for-deletion/page.tsx`; `DueForDeletionPage`; `notFound` |
| `R045` | `/personnel-files` | Personnel file directory and expiry overview | Category-scoped personnel file officer | `personnel-files/page.tsx`; `PersonnelFilesPage`; `notFound` |
| `R050` | `/personnel-files/payslip-batches/[batchId]` | Payslip matching, review and distribution workspace | Officer authorized for payslip batch | `personnel-files/payslip-batches/[batchId]/page.tsx`; `PayslipBatchPage`; `notFound` |
| `R049` | `/personnel-files/payslip-batches` | Payslip batch creation and history | Officer allowed to run payslip batches | `personnel-files/payslip-batches/page.tsx`; `PayslipBatchesPage`; `notFound` |
| `R051` | `/personnel-files/sick-leave` | Sick-leave and sick-note overview | Officer managing sick-note category | `personnel-files/sick-leave/page.tsx`; `SickLeavePage`; `notFound` |
| `R061` | `/reports` | Work and absence reports | Employee with report scope | `reports/page.tsx`; `ReportsPage`; `getCurrentEmployee` |
| `R062` | `/reports/projects` | Project hours, budgets and contributions | Authorized project report reader | `reports/projects/page.tsx`; `ProjectReportsPage` |
| `R063` | `/reports/vehicles` | Vehicle distance reports | Employee with vehicle report scope | `reports/vehicles/page.tsx`; `VehicleDistanceReportPage`; `getCurrentEmployee` |
| `R065` | `/scheduling` | Shift schedule and planning workspace | Organization employee; planner/employee capabilities vary | `scheduling/page.tsx`; `SchedulingPage` |
| `R158` | `/team/absences` | Managed employee absence calendar and table | Manager or workforce admin | `team/absences/page.tsx`; `TeamAbsencesPage`; `getCurrentEmployee` |
| `R159` | `/team/driving` | Missing driving details for recorded work | Organization owner/admin or scoped manager | `team/driving/page.tsx`; `TeamDrivingPage` |
| `R157` | `/team` | Managed team directory and current status | Manager or workforce admin | `team/page.tsx`; `TeamPage`; `getCurrentEmployee` |
| `R160` | `/team/period-submissions` | Submission-period coverage and employee status | Organization owner/admin or scoped manager | `team/period-submissions/page.tsx`; `PeriodSubmissionsPage` |
| `R162` | `/team/presence/[locationId]` | Presence at a selected location | Authorized presence reader for location | `team/presence/[locationId]/page.tsx`; `LocationPresencePage`; `notFound` |
| `R161` | `/team/presence` | Presence overview grouped by location | Authorized organization presence reader | `team/presence/page.tsx`; `WhoIsInPage` |
| `R163` | `/time-tracking` | Clocking, daily summary, timeline and history **Refreshed reference.** | Employee | `time-tracking/page.tsx`; `TimeTrackingPage` |
| `R164` | `/today` | Manager daily briefing | Manager or workforce admin | `today/page.tsx`; `TodayPage`; `getCurrentEmployee` |
| `R166` | `/travel-expenses/[claimId]` | Legacy travel expense claim detail | Employee/authorized legacy claim reader | `travel-expenses/[claimId]/page.tsx`; `TravelExpenseClaimPage` |
| `R167` | `/travel-expenses/finance` | Expense reimbursement queue, payroll confirmation and finance exports | Expense finance actor; read/settle/export capabilities differ | `travel-expenses/finance/page.tsx`; `TravelExpenseFinancePage`; `notFound` |
| `R165` | `/travel-expenses` | Personal expense reports and review/finance entry points | Employee; approver and finance entries depend on capabilities | `travel-expenses/page.tsx`; `TravelExpensesPage` |
| `R168` | `/travel-expenses/reports/[reportId]` | Expense report editor or submitted report | Authorized report owner/reader; lifecycle changes rendered view | `travel-expenses/reports/[reportId]/page.tsx`; `TravelExpenseReportPage`; `notFound` |
| `R172` | `/works-council` | Works council reporting portal | Authorized works council reader; portal feature gate | `works-council/page.tsx`; `WorksCouncilPage`; `requireUser` |

### Authenticated settings (68)

Source root: `apps/webapp/src/app/[locale]/(app)/settings`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R068` | `/settings/approval-policies` | Approval policies, groups, triage, escalation and history | Organization admin; escalation panels also depend on Approval management capability | `approval-policies/page.tsx`; `ApprovalPoliciesSettingsPage`; `getCurrentSettingsRouteContext` |
| `R069` | `/settings/audit-export` | Audit activity, configuration, packages and verification keys | Organization admin | `audit-export/page.tsx`; `AuditExportSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R071` | `/settings/avv` | Organization AVV details and download | Organization admin; billing-enabled deployment | `avv/page.tsx`; `AvvPage`; `requireOrgAdminSettingsAccess` |
| `R073` | `/settings/billable-time/accounting` | Accounting connection and hand-off configuration | Organization admin; Billable Time enabled with currency | `billable-time/accounting/page.tsx`; `AccountingSettingsPage`; `requireBillableTimeSettingsAccess` |
| `R074` | `/settings/billable-time/cost-rates` | Employee cost rates | Organization admin; Billable Time enabled with currency | `billable-time/cost-rates/page.tsx`; `CostRatesPage`; `requireBillableTimeSettingsAccess` |
| `R075` | `/settings/billable-time/hand-off` | Invoice draft hand-off workspace | Organization admin; Billable Time enabled with currency | `billable-time/hand-off/page.tsx`; `HandOffPage`; `requireBillableTimeSettingsAccess` |
| `R072` | `/settings/billable-time` | Billable currency settings | Organization admin; Billable Time enabled with currency | `billable-time/page.tsx`; `BillableTimeSettingsPage`; `requireBillableTimeSettingsAccess` |
| `R076` | `/settings/billable-time/rates` | Billable rates overview and management | Organization admin; Billable Time enabled with currency | `billable-time/rates/page.tsx`; `BillableRatesPage`; `requireBillableTimeSettingsAccess` |
| `R077` | `/settings/billing` | Subscription, payment methods and invoices | Organization admin; billing-enabled deployment | `billing/page.tsx`; `BillingSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R078` | `/settings/calendar` | Calendar configuration and sync-related settings | Manager settings tier or above; management differs by tier | `calendar/page.tsx`; `CalendarSettingsPage`; `getCurrentSettingsRouteContext` |
| `R080` | `/settings/clocking` | Tracking, automatic clock-out, reminders and period submissions | Organization admin | `clocking/page.tsx`; `ClockingSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R082` | `/settings/closed-months` | Close/reopen month controls and evidence | Organization admin | `closed-months/page.tsx`; `ClosedMonthsSettingsPage` |
| `R083` | `/settings/compliance` | Working-time compliance exception management | Manager or workforce admin with employee profile | `compliance/page.tsx`; `ComplianceSettingsPage` |
| `R084` | `/settings/compliance/works-council` | Works council portal configuration | Organization admin | `compliance/works-council/page.tsx`; `WorksCouncilSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R086` | `/settings/custom-fields` | Custom fields for employees, projects and customers | Organization admin | `custom-fields/page.tsx`; `CustomFieldsSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R087` | `/settings/customers` | Customer contacts and customer configuration | Manager settings tier or above; Projects feature context | `customers/page.tsx`; `CustomerSettingsPage`; `getCurrentSettingsRouteContext` |
| `R088` | `/settings/demo` | Generate or clear demonstration data | Organization admin; organization demo-data feature enabled | `demo/page.tsx`; `DemoSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R090` | `/settings/driving-licence` | Driving licence policy, drivers, verifiers and retention | Organization admin; driving-licence settings visibility | `driving-licence/page.tsx`; `DrivingLicenceSettingsPage`; `requireDrivingLicenceSettingsPage` |
| `R093` | `/settings/employees/[employeeId]` | Employee detail, lifecycle and configuration | Manager settings tier or above; target employee scope | `employees/[employeeId]/page.tsx`; `EmployeeDetailPage`; `getCurrentSettingsRouteContext` |
| `R092` | `/settings/employees` | Employee, member and invitation administration | Manager settings tier or above; scoped management | `employees/page.tsx`; `EmployeesPage`; `getCurrentSettingsRouteContext` |
| `R097` | `/settings/enterprise/api-keys/[keyId]` | API key detail and configuration | Organization admin; key authorization | `enterprise/api-keys/[keyId]/page.tsx`; `ApiKeyDetailPage`; `requireOrgAdminSettingsAccess` |
| `R096` | `/settings/enterprise/api-keys` | API keys and webhooks developer settings | Organization admin | `enterprise/api-keys/page.tsx`; `DeveloperSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R100` | `/settings/enterprise/domains` | Organization domains and branding | Organization admin | `enterprise/domains/page.tsx`; `CustomDomainsPage`; `requireOrgAdminSettingsAccess` |
| `R101` | `/settings/enterprise/email` | Email delivery configuration and email overrides | Organization admin | `enterprise/email/page.tsx`; `EmailConfigPage`; `requireOrgAdminSettingsAccess` |
| `R102` | `/settings/enterprise/identity-setup` | Identity setup, SSO, social login, provisioning and MFA policy | Organization admin | `enterprise/identity-setup/page.tsx`; `EnterpriseIdentitySetupPage`; `requireOrgAdminSettingsAccess` |
| `R104` | `/settings/equipment` | Equipment types, identities and retention | Organization admin; Equipment feature enabled | `equipment/page.tsx`; `EquipmentSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R107` | `/settings/export/history/[organizationId]` | Organization-addressed export history arrival | Organization admin; may first prompt an organization switch | `export/history/[organizationId]/page.tsx`; `OrganizationExportHistoryPage`; `requireOrgAdminSettingsAccess` |
| `R105` | `/settings/export` | Organization data export request and history | Organization admin | `export/page.tsx`; `ExportSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R106` | `/settings/export-operations` | Export operation health and delivery visibility | Organization admin | `export-operations/page.tsx`; `ExportOperationsPage`; `requireOrgAdminSettingsAccess` |
| `R109` | `/settings/implementation-checklist` | Implementation checklist and go-live rehearsal | Organization admin | `implementation-checklist/page.tsx`; `ImplementationChecklistPage`; `requireOrgAdminSettingsAccess` |
| `R111` | `/settings/import/[batchId]` | Import batch review: CSV work, historical vacation or provider data | Organization admin; organization-scoped batch | `import/[batchId]/page.tsx`; `ImportReviewRoute`; `requireOrgAdminSettingsAccess` |
| `R110` | `/settings/import` | Import source selection and setup | Organization admin | `import/page.tsx`; `ImportPage`; `requireOrgAdminSettingsAccess` |
| `R112` | `/settings/kiosks` | Shared kiosk device management | Organization admin | `kiosks/page.tsx`; `KioskSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R114` | `/settings/locations/[locationId]` | Location detail and subareas | Manager settings tier or above; admin management controls | `locations/[locationId]/page.tsx`; `LocationDetailPage`; `getCurrentSettingsRouteContext` |
| `R113` | `/settings/locations` | Locations and subareas | Manager settings tier or above; admin management controls | `locations/page.tsx`; `LocationSettingsPage`; `getCurrentSettingsRouteContext` |
| `R115` | `/settings/my-data` | Download personal data held by active organization | Signed-in user | `my-data/page.tsx`; `MyDataPage`; `requireUser` |
| `R116` | `/settings/notification-channels` | Organization notification channels and chat integrations | Organization admin | `notification-channels/page.tsx`; `ChatSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R117` | `/settings/notifications` | Personal notification preferences | Signed-in user | `notifications/page.tsx`; `NotificationsSettingsPage`; `requireUser` |
| `R118` | `/settings/organization` | Organization identity, membership and configuration | Organization admin | `organization/page.tsx`; `OrganizationsPage`; `requireOrgAdminSettingsAccess` |
| `R066` | `/settings` | Settings overview and available destinations | Signed-in user; entries vary by settings access tier | `page.tsx`; `SettingsPage`; `getCurrentSettingsRouteContext` |
| `R120` | `/settings/payroll-access` | Payroll officer grants and coverage | Organization admin with payroll-access administration authorization | `payroll-access/page.tsx`; `PayrollAccessSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R121` | `/settings/payroll-export` | Payroll connector configuration and export tools | Organization admin | `payroll-export/page.tsx`; `PayrollExportPage`; `requireOrgAdminSettingsAccess` |
| `R122` | `/settings/payroll-readiness` | Payroll readiness checks and remediation | Organization admin | `payroll-readiness/page.tsx`; `PayrollReadinessPage`; `requireOrgAdminSettingsAccess` |
| `R123` | `/settings/permissions` | Permission review and scoped management | Manager settings tier or above; admin actions differ | `permissions/page.tsx`; `PermissionsPage`; `getCurrentSettingsRouteContext` |
| `R124` | `/settings/personnel-files` | Officer grants, expiry reminders and document retention | Organization admin; Personnel Files feature enabled | `personnel-files/page.tsx`; `PersonnelFileSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R125` | `/settings/position-capture` | Organization position capture policy | Organization admin | `position-capture/page.tsx`; `PositionCaptureSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R126` | `/settings/position-stamps` | Own clock-event position stamps and consent | Signed-in user | `position-stamps/page.tsx`; `PositionStampsPage`; `requireUser` |
| `R127` | `/settings/profile` | Personal profile, custom fields, skills and display preferences | Signed-in user | `profile/page.tsx`; `ProfilePage`; `requireUser` |
| `R128` | `/settings/projects` | Projects, tasks and project templates | Manager settings tier or above; project managers below tier receive tasks-only view | `projects/page.tsx`; `ProjectSettingsPage`; `getCurrentSettingsRouteContext` |
| `R129` | `/settings/report-share-links` | Frozen report share link management | Organization admin | `report-share-links/page.tsx`; `ReportShareLinksPage`; `requireOrgAdminSettingsAccess` |
| `R130` | `/settings/roles` | Custom organization role management | Organization admin | `roles/page.tsx`; `CustomRolesSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R131` | `/settings/scheduled-exports` | Recurring payroll, data and audit exports | Organization admin | `scheduled-exports/page.tsx`; `ScheduledExportsPage`; `requireOrgAdminSettingsAccess` |
| `R132` | `/settings/security` | Password, two-factor authentication, passkeys, kiosk credentials and sessions | Signed-in user | `security/page.tsx`; `SecuritySettingsPage`; `requireUser` |
| `R133` | `/settings/shifts` | Shift templates and coverage targets | Scheduling settings reader; team/subarea capabilities | `shifts/page.tsx`; `ShiftTemplatesPage`; `getSchedulingSettingsAccessContext` |
| `R134` | `/settings/skills` | Skill catalog, qualifications and certification reminders | Manager settings tier or above; admin manages catalog | `skills/page.tsx`; `SkillsSettingsPage`; `getCurrentSettingsRouteContext` |
| `R136` | `/settings/statistics` | Organization or managed-scope statistics | Manager settings tier or above | `statistics/page.tsx`; `StatisticsPage`; `getCurrentSettingsRouteContext` |
| `R137` | `/settings/surcharges` | Surcharge configuration and scoped view | Manager settings tier or above; admin manages | `surcharges/page.tsx`; `SurchargeSettingsPage`; `getCurrentSettingsRouteContext` |
| `R140` | `/settings/teams/[teamId]` | Team detail, members and configuration | Authorized team settings reader/operator | `teams/[teamId]/page.tsx`; `TeamDetailPage` |
| `R138` | `/settings/teams` | Team directory and administration | Manager settings tier or above; team management scope | `teams/page.tsx`; `TeamsPage`; `getCurrentSettingsRouteContext` |
| `R142` | `/settings/travel-expenses` | Expense review, receipt, currency, mileage and per diem policies | Organization admin | `travel-expenses/page.tsx`; `TravelExpenseSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R145` | `/settings/vacation/employees/[employeeId]` | Employee vacation allowance editing | Authorized employee allowance administrator | `vacation/employees/[employeeId]/page.tsx`; `EmployeeAllowanceEditPage` |
| `R144` | `/settings/vacation/employees` | Employee vacation allowances | Organization admin | `vacation/employees/page.tsx`; `EmployeeAllowancesPage`; `requireOrgAdminSettingsAccess` |
| `R143` | `/settings/vacation` | Absence categories, vacation policies, assignments and holidays | Manager settings tier or above; admin manages policies | `vacation/page.tsx`; `VacationSettingsPage`; `getCurrentSettingsRouteContext` |
| `R147` | `/settings/vehicles` | Organization vehicles, use switch and driver assignments | Organization admin | `vehicles/page.tsx`; `VehicleSettingsPage`; `requireOrgAdminSettingsAccess` |
| `R149` | `/settings/wellness` | Personal water reminders and hydration preferences | Signed-in user | `wellness/page.tsx`; `WellnessPage`; `requireUser` |
| `R150` | `/settings/work-categories` | Work categories and category sets | Manager settings tier or above; admin manages | `work-categories/page.tsx`; `WorkCategoriesSettingsPage`; `getCurrentSettingsRouteContext` |
| `R151` | `/settings/work-diagnostics` | Missing/conflicting work records, repair and proposal tools | Organization admin | `work-diagnostics/page.tsx`; `WorkDiagnosticsPage`; `requireOrgAdminSettingsAccess` |
| `R152` | `/settings/work-policies` | Work schedules, limits, breaks and change policies | Manager settings tier or above; admin manages | `work-policies/page.tsx`; `WorkPoliciesPage`; `getCurrentSettingsRouteContext` |

### Auth and public information (10)

Source root: `apps/webapp/src/app/[locale]/(auth)`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R003` | `/accept-invitation/[invitationId]` | Review and accept organization invitation | Invitation recipient; sign-in/join states handled by form | `accept-invitation/[invitationId]/page.tsx`; `AcceptInvitationPage` |
| `R022` | `/forgot-password` | Request password reset | Public visitor | `forgot-password/page.tsx`; `Page` |
| `R024` | `/join/[code]` | Join organization by code | Public join visitor; code and account states handled by form | `join/[code]/page.tsx`; `JoinPage` |
| `R026` | `/licenses` | Open source license information and table | Public visitor | `licenses/page.tsx`; `LicensesPage`; `notFound` |
| `R064` | `/reset-password` | Set replacement password using reset token | Public visitor with reset token | `reset-password/page.tsx`; `Page` |
| `R155` | `/sign-in` | Sign in; browser and store-app hand-off variants | Public visitor | `sign-in/page.tsx`; `Page` |
| `R156` | `/sign-up` | Create account | Public visitor; deployment/domain signup policy | `sign-up/page.tsx`; `Page` |
| `R169` | `/verify-2fa` | Complete sign-in second-factor challenge | Visitor in two-factor sign-in flow | `verify-2fa/page.tsx`; `Verify2FAPage`; `getRequestSession` |
| `R170` | `/verify-email` | Email token verification and next-step outcome | Verification-link recipient | `verify-email/page.tsx`; `VerifyEmailPage` |
| `R171` | `/verify-email-pending` | Pending verification instructions and resend | Account awaiting verification | `verify-email-pending/page.tsx`; `VerifyEmailPendingPage` |

### Platform administration (9)

Source root: `apps/webapp/src/app/[locale]/(admin)/platform-admin`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R053` | `/platform-admin/analytics` | Platform analytics | Platform admin | `analytics/page.tsx`; `PlatformAnalyticsPage` |
| `R054` | `/platform-admin/billing` | Platform subscription overview | Platform admin; billing-enabled deployment | `billing/page.tsx`; `AdminBillingPage` |
| `R055` | `/platform-admin/diagnostics` | Deployment diagnostics | Platform admin | `diagnostics/page.tsx`; `PlatformDiagnosticsPage`; `requirePlatformAdmin` |
| `R056` | `/platform-admin/organizations` | Platform organization management | Platform admin | `organizations/page.tsx`; `OrganizationsPage` |
| `R052` | `/platform-admin` | Platform overview and operational statistics | Platform admin | `page.tsx`; `AdminDashboardPage` |
| `R057` | `/platform-admin/settings` | Platform configuration and approval maintenance | Platform admin | `settings/page.tsx`; `PlatformSettingsPage` |
| `R058` | `/platform-admin/system-email-templates` | Platform system email overrides | Platform admin | `system-email-templates/page.tsx`; `PlatformSystemEmailTemplatesPage` |
| `R059` | `/platform-admin/users` | Platform user management | Platform admin | `users/page.tsx`; `UsersPage` |
| `R060` | `/platform-admin/worker-queue` | Worker queue and reliability health | Platform admin | `worker-queue/page.tsx`; `WorkerQueuePage`; `requirePlatformAdmin` |

### Onboarding (9)

Source root: `apps/webapp/src/app/[locale]/onboarding`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R032` | `/onboarding/complete` | Onboarding completion and summary | Signed-in onboarding user | `complete/page.tsx`; `CompletePage` |
| `R033` | `/onboarding/notifications` | Initial personal notification preferences | Signed-in onboarding user | `notifications/page.tsx`; `NotificationsPage` |
| `R034` | `/onboarding/organization` | Create or connect an organization | Signed-in onboarding user; organization creation policy | `organization/page.tsx`; `OrganizationPage` |
| `R035` | `/onboarding/profile` | Initial personal profile details | Signed-in onboarding user | `profile/page.tsx`; `ProfilePage` |
| `R036` | `/onboarding/vacation-policy` | Initial organization vacation policy | Onboarding organization admin; non-admin step skipping | `vacation-policy/page.tsx`; `VacationPolicyPage` |
| `R037` | `/onboarding/welcome` | Start or resume workspace onboarding | Signed-in onboarding user | `welcome/page.tsx`; `WelcomePage` |
| `R038` | `/onboarding/wellness` | Initial wellness preferences | Signed-in onboarding user | `wellness/page.tsx`; `WellnessPage` |
| `R039` | `/onboarding/work-schedule` | Initial organization weekly work schedule | Onboarding organization admin; non-admin step skipping | `work-schedule/page.tsx`; `WorkSchedulePage` |
| `R040` | `/onboarding/work-templates` | Initial organization work templates | Onboarding organization admin; non-admin step skipping | `work-templates/page.tsx`; `WorkTemplatesPage` |

### Initial platform setup (1)

Source root: `apps/webapp/src/app/[locale]/(setup)`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R153` | `/setup` | Initial platform setup and authorization-required state | Instance bootstrap operator with temporary setup authorization | `setup/page.tsx`; `SetupPage` |

### Public shared report (1)

Source root: `apps/webapp/src/app/[locale]/(share)`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R154` | `/share/[token]` | Frozen shared report or unavailable-link state | Anyone holding valid report share token | `share/[token]/page.tsx`; `SharePage` |

### Standalone initialization, kiosk and MFA (3)

Source root: `apps/webapp/src/app/[locale]`.

| Inventory ID | Normalized route | Purpose | Likely actor / access owner | Source and observed evidence |
| --- | --- | --- | --- | --- |
| `R023` | `/init` | Session and organization initialization/selection | Signed-in user; session and SSO recovery states | `init/page.tsx`; `InitPage` |
| `R025` | `/kiosk` | Shared-device employee identification and clocking | Kiosk device token; employee credential flow | `kiosk/page.tsx`; `KioskPage` |
| `R027` | `/mfa` | Organization security verification and authenticator enrollment | Signed-in user facing organization MFA requirements | `mfa/page.tsx`; `MfaPage`; `getRequestSession` |

## Redirect-only page templates (19)

All are in the app/settings shell, beneath source root `apps/webapp/src/app/[locale]/(app)/settings`. The destination column shows the intended success destination; refusal branches may return to `/settings` or sign-in. Destination query tabs are states of the destination template.

| Inventory ID | Normalized route | Success destination | Existing actor/access evidence | Source |
| --- | --- | --- | --- | --- |
| `R067` | `/settings/approval-escalation` | `/settings/approval-policies?tab=escalation` | Approval management capability; `redirectWithLocale` | `approval-escalation/page.tsx` |
| `R070` | `/settings/audit-log` | `/settings/audit-export?tab=activity` | Organization admin; `redirectWithLocale` | `audit-log/page.tsx` |
| `R079` | `/settings/change-policies` | `/settings/work-policies?tab=changes` | Manager settings tier or above; `redirectWithLocale` | `change-policies/page.tsx` |
| `R081` | `/settings/clockodo-import` | `/settings/import` | Authenticated app visitor; destination enforces admin access; `redirectWithLocale` | `clockodo-import/page.tsx` |
| `R085` | `/settings/coverage-rules` | `/settings/shifts?tab=coverage` | Scheduling settings scope; `redirectWithLocale` | `coverage-rules/page.tsx` |
| `R089` | `/settings/discord` | `/settings/notification-channels?tab=discord` | Organization admin; `redirectWithLocale` | `discord/page.tsx` |
| `R091` | `/settings/email-templates` | `/settings/enterprise/email?tab=templates` | Organization admin; `redirectWithLocale` | `email-templates/page.tsx` |
| `R094` | `/settings/employees/new` | `/settings/organization` | Authenticated app visitor; destination enforces admin access; `redirectWithLocale` | `employees/new/page.tsx` |
| `R095` | `/settings/enterprise` | `/settings/enterprise/domains` | Authenticated app visitor; destination enforces admin access; `redirectWithLocale` | `enterprise/page.tsx` |
| `R098` | `/settings/enterprise/audit-log` | `/settings/audit-export?tab=activity` | Organization admin; `redirectWithLocale` | `enterprise/audit-log/page.tsx` |
| `R099` | `/settings/enterprise/branding` | `/settings/enterprise/domains?tab=branding` | Organization admin; `redirectWithLocale` | `enterprise/branding/page.tsx` |
| `R103` | `/settings/enterprise/sso` | `/settings/enterprise/identity-setup?tab=sso` | Organization admin; `redirectWithLocale` | `enterprise/sso/page.tsx` |
| `R108` | `/settings/holidays` | `/settings/vacation?tab=holidays` | Manager settings tier or above; `redirectWithLocale` | `holidays/page.tsx` |
| `R119` | `/settings/organizations` | `/settings/organization` | Authenticated app visitor; destination enforces admin access; `redirectWithLocale` | `organizations/page.tsx` |
| `R135` | `/settings/slack` | `/settings/notification-channels?tab=slack` | Organization admin; `redirectWithLocale` | `slack/page.tsx` |
| `R139` | `/settings/teams-notifications` | `/settings/notification-channels?tab=teams` | Organization admin; `redirectWithLocale` | `teams-notifications/page.tsx` |
| `R141` | `/settings/telegram` | `/settings/notification-channels?tab=telegram` | Organization admin; `redirectWithLocale` | `telegram/page.tsx` |
| `R146` | `/settings/vehicle-use` | `/settings/vehicles?tab=use` | Organization admin; `redirectWithLocale` | `vehicle-use/page.tsx` |
| `R148` | `/settings/webhooks` | `/settings/enterprise/api-keys?tab=webhooks` | Organization admin; `redirectWithLocale` | `webhooks/page.tsx` |

## Boundaries and non-route surfaces

| Surface | Evidence and classification |
| --- | --- |
| Locale error recovery | `apps/webapp/src/app/[locale]/error.tsx`; user-facing error boundary, not a URL template. |
| Locale not-found | `apps/webapp/src/app/[locale]/not-found.tsx`; unknown/unavailable route state, not a URL template. |
| Settings error recovery | `apps/webapp/src/app/[locale]/(app)/settings/error.tsx`; nested error boundary, not a URL template. |
| Loading states | No `loading.tsx` files; layouts/pages use inline Suspense fallbacks and loading components. These belong to the screen/shell being loaded. |
| Other special files | No `global-error.tsx`, `default.tsx`, `template.tsx`, `forbidden.tsx` or `unauthorized.tsx` found. |
| API and downloads | `apps/webapp/src/app/api/**/route.ts` are excluded. The only `route.ts` outside `/api` is `[locale]/(app)/works-council/export/route.ts`, an export handler, not a page template. |
| Middleware names without pages | `/welcome` appears in proxy public/auth lists but has no page template. There is no `/onboarding` index page, `/settings/enterprise/identity-setup` is a page, and `/settings/enterprise` is only an alias. |
| Tests and support files | `page.test.*`, `page.guard.test.ts`, `page.scope.test.ts`, `page.hydration.test.tsx`, `page.timezone.test.ts`, `page.server.test.tsx`, layouts, component files and `__tests__` directories do not create routes. |
| Static public HTML | No `.html` or `.htm` documents found beneath `apps/webapp/public`. |

## Ambiguous ticket boundaries and product questions

1. **Redirect aliases — resolved:** the user approved covering the 19 redirect-only templates through their destination-page tickets, with every alias explicitly listed and verified. They do not receive separate visual-refactor tickets.
2. **Refreshed references:** `/` and `/time-tracking` already supply the approved direction. Confirm whether their tickets should be conformance/verification work, further refresh work, or represented as already completed references.
3. **Shared foundations and boundary states:** app navigation, settings navigation, auth/onboarding shells, common loading states and the three error/not-found boundaries have no independent page templates. The user has approved limited separate shared-foundation tickets; the spec still needs to map these surfaces to explicit owners and dependencies.
4. **Legacy persistent pages:** `/approvals` and `/travel-expenses/[claimId]` still render real screens. They are not redirect aliases. Any consolidation or retirement would require a separate product decision; their current behavior belongs in preservation requirements.
5. **Shared implementations across distinct routes:** `/calendar/[employeeId]` imports `CalendarPageContent` from `/calendar`; `/settings/export/history/[organizationId]` renders the export settings view after organization-aware arrival; employee work balance also appears inside employee settings. The agreed route-template rule yields separate route rows while reusable implementation may be shared.
6. **Multiple experiences within one route:** settings tabs, the import batch provider variants, expense report draft/submitted states, project-manager tasks-only view, finance capabilities, browser/store-app sign-in and driving-licence role tabs are states of their existing templates. They must be captured in each route ticket's behavior inventory; this document does not create extra routes or drop variants.
7. **Conditional visibility:** billing, demo data, equipment, personnel files, Billable Time, scheduling, project and works-council settings have deployment/module/access variants. Their existence in the repository is established; the final spec should state which configurations are required for acceptance rather than assuming every route appears for every user.
8. **Initialization and verification:** `/init`, `/mfa`, `/verify-email`, `/verify-2fa` and `/setup` may navigate automatically or deny entry in some states but have meaningful user-facing selection, enrollment, verification, recovery or setup screens. They are persistent templates, unlike the 19 settings aliases.

## Discovery validation

An exact-name filesystem enumeration found 172 `page.tsx` files. Normalization produced 172 unique route templates. Every enumerated source is represented exactly once across the persistent-page and redirect-only tables. Counts were cross-checked by route group. This was read-only repository discovery apart from this draft document; no runtime behavior, permissions, issues or UI implementation were changed.
