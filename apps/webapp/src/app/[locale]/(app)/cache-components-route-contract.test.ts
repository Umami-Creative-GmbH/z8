import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const REVIEWED_RETAINED_CONNECTION_FILES = [
	"src/app/[locale]/(app)/absences/page.tsx",
	"src/app/[locale]/(app)/organization/page.tsx",
	"src/app/[locale]/(app)/payroll/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
	"src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
	"src/app/[locale]/(app)/settings/wellness/page.tsx",
	"src/app/[locale]/(app)/works-council/page.tsx",
	"src/app/[locale]/(auth)/layout.tsx",
	"src/app/[locale]/(setup)/setup/page.tsx",
	"src/app/[locale]/onboarding/layout.tsx",
] as const;

const PENDING_CONNECTION_FILES = [] as const;

const REVIEWED_RETAINED_CONNECTION_BOUNDARIES = [
	{
		file: "src/app/[locale]/(auth)/layout.tsx",
		contentComponent: "AuthLayoutContent",
		fallbackComponent: "AuthLayoutLoading",
		reasonCategory: "trusted-request-auth",
		reason:
			"Host, domain, consent, Turnstile, and random auth data must remain request-specific.",
		operation: "const headersList = await headers();",
	},
	{
		file: "src/app/[locale]/onboarding/layout.tsx",
		contentComponent: "OnboardingLayoutContent",
		fallbackComponent: "OnboardingLayoutLoading",
		reasonCategory: "random-selection",
		reason: "Random onboarding backgrounds must be selected per request.",
		operation: "const backgroundImage = selectRandomAuthBackgroundImage();",
	},
	{
		file: "src/app/[locale]/(app)/organization/page.tsx",
		contentComponent: "OrganizationPageContent",
		fallbackComponent: "OrganizationPageLoading",
		reasonCategory: "effect-current-time",
		reason:
			"Effect runtime performs synchronous current-time work and must execute per request outside prerendered shell.",
		operation:
			"const [t, result] = await Promise.all([getTranslate(), getOrgChartInitialGraph()]);",
	},
	{
		file: "src/app/[locale]/(app)/payroll/page.tsx",
		contentComponent: "PayrollPageContent",
		fallbackComponent: "PayrollPageLoading",
		reasonCategory: "current-period",
		reason: "The current payroll period must be resolved per request.",
		operation: "const now = DateTime.utc();",
	},
	{
		file: "src/app/[locale]/(app)/absences/page.tsx",
		contentComponent: "AbsencesPageContent",
		fallbackComponent: "AbsencesPageLoading",
		reasonCategory: "current-calendar",
		reason:
			"The employee's current local calendar year must be resolved per request.",
		operation: "const now = DateTime.now().setZone(timezone);",
	},
	{
		file: "src/app/[locale]/(app)/works-council/page.tsx",
		contentComponent: "WorksCouncilPageContent",
		fallbackComponent: "WorksCouncilPageLoading",
		reasonCategory: "authorization-audit",
		reason:
			"This protected view must execute per request so authorization and audit are not reused.",
		operation: "const authContext = await requireUser();",
	},
	{
		file: "src/app/[locale]/(app)/settings/wellness/page.tsx",
		contentComponent: "WellnessPageContent",
		fallbackComponent: "WellnessPageLoading",
		reasonCategory: "effect-current-time",
		reason:
			"The wellness Effect program requires synchronous current-time execution per request.",
		operation: "const [, settingsResult, t] = await Promise.all([",
	},
	{
		file: "src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
		contentComponent: "PayrollReadinessPageContent",
		fallbackComponent: "PayrollReadinessPageLoading",
		reasonCategory: "current-period",
		reason:
			"The default payroll-readiness period must be resolved per request.",
		operation:
			"const period = getPayrollReadinessPeriod(resolvedSearchParams);",
	},
	{
		file: "src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
		contentComponent: "EmployeeAllowancesContent",
		fallbackComponent: "EmployeeAllowancesLoading",
		reasonCategory: "current-calendar",
		reason: "The current vacation allowance year must be resolved per request.",
		operation: "const currentYear = calendarYearAt(",
	},
	{
		file: "src/app/[locale]/(setup)/setup/page.tsx",
		contentComponent: "SetupPageContent",
		fallbackComponent: "SetupPageLoading",
		reasonCategory: "instrumentation-randomness",
		reason:
			"OpenTelemetry database instrumentation creates synchronous random trace IDs per request.",
		operation: "const configured = await isPlatformConfigured();",
	},
] as const;

const APPROVED_CONNECTION_REASON_CATEGORIES = new Set([
	"authorization-audit",
	"current-calendar",
	"current-period",
	"effect-current-time",
	"instrumentation-randomness",
	"random-selection",
	"trusted-request-auth",
]);

const SHELL_WORK_QUEUE = [
	{
		file: "src/app/[locale]/(app)/organization/page.tsx",
		fallbackComponent: "OrganizationPageLoading",
		contentComponent: "OrganizationPageContent",
	},
	{
		file: "src/app/[locale]/(app)/calendar/page.tsx",
		fallbackComponent: "CalendarPageLoading",
		contentComponent: "CalendarPageContent",
	},
	{
		file: "src/app/[locale]/(app)/time-tracking/page.tsx",
		fallbackComponent: "TimeTrackingPageLoading",
		contentComponent: "TimeTrackingPageContent",
	},
	{
		file: "src/app/[locale]/(app)/team/absences/page.tsx",
		fallbackComponent: "TeamAbsencesPageLoading",
		contentComponent: "TeamAbsencesPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx",
		fallbackComponent: "LocationDetailPageLoading",
		contentComponent: "LocationDetailPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/approval-policies/page.tsx",
		fallbackComponent: "ApprovalPoliciesSettingsLoading",
		contentComponent: "ApprovalPoliciesSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/permissions/page.tsx",
		fallbackComponent: "PermissionsPageLoading",
		contentComponent: "PermissionsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/work-categories/page.tsx",
		fallbackComponent: "WorkCategoriesSettingsLoading",
		contentComponent: "WorkCategoriesSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/avv/page.tsx",
		fallbackComponent: "AvvPageLoading",
		contentComponent: "AvvPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/shifts/page.tsx",
		fallbackComponent: "ShiftTemplatesPageLoading",
		contentComponent: "ShiftTemplatesPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading shift template settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/statistics/page.tsx",
		fallbackComponent: "StatisticsLoading",
		contentComponent: "StatisticsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/compliance/page.tsx",
		fallbackComponent: "ComplianceSettingsLoading",
		contentComponent: "ComplianceSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/implementation-checklist/page.tsx",
		fallbackComponent: "ImplementationChecklistPageLoading",
		contentComponent: "ImplementationChecklistPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/surcharges/page.tsx",
		fallbackComponent: "SurchargeSettingsPageLoading",
		contentComponent: "SurchargeSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading surcharge settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/change-policies/page.tsx",
		fallbackComponent: "ChangePoliciesSettingsPageLoading",
		contentComponent: "ChangePoliciesSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading change policy settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/payroll-access/page.tsx",
		fallbackComponent: "PayrollAccessSettingsPageLoading",
		contentComponent: "PayrollAccessSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/vacation/page.tsx",
		fallbackComponent: "VacationSettingsLoading",
		contentComponent: "VacationSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/calendar/page.tsx",
		fallbackComponent: "CalendarSettingsPageLoading",
		contentComponent: "CalendarSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/work-policies/page.tsx",
		fallbackComponent: "WorkPoliciesPageLoading",
		contentComponent: "WorkPoliciesPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading work policy settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/roles/page.tsx",
		fallbackComponent: "CustomRolesSettingsPageLoading",
		contentComponent: "CustomRolesSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading custom role settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/projects/page.tsx",
		fallbackComponent: "ProjectSettingsPageLoading",
		contentComponent: "ProjectSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading project settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/holidays/page.tsx",
		fallbackComponent: "HolidaySettingsPageLoading",
		contentComponent: "HolidaySettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading holiday settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/compliance/works-council/page.tsx",
		fallbackComponent: "WorksCouncilSettingsPageLoading",
		contentComponent: "WorksCouncilSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/locations/page.tsx",
		fallbackComponent: "LocationSettingsPageLoading",
		contentComponent: "LocationSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading location settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/telegram/page.tsx",
		fallbackComponent: "TelegramSettingsLoading",
		contentComponent: "TelegramSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/email-templates/page.tsx",
		fallbackComponent: "EmailTemplatesSettingsPageLoading",
		contentComponent: "EmailTemplatesSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/enterprise/email/page.tsx",
		fallbackComponent: "EmailConfigLoading",
		contentComponent: "EmailConfigContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/skills/page.tsx",
		fallbackComponent: "SkillsSettingsPageLoading",
		contentComponent: "SkillsSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading skill settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/billing/page.tsx",
		fallbackComponent: "BillingSettingsLoading",
		contentComponent: "BillingSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/organizations/page.tsx",
		fallbackComponent: "OrganizationsPageLoading",
		contentComponent: "OrganizationsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/travel-expenses/page.tsx",
		fallbackComponent: "TravelExpenseSettingsPageLoading",
		contentComponent: "TravelExpenseSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading travel expense settings",
	},
	{
		file: "src/app/[locale]/(app)/settings/customers/page.tsx",
		fallbackComponent: "CustomerSettingsPageLoading",
		contentComponent: "CustomerSettingsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading customer settings",
	},
	{
		file: "src/app/[locale]/(app)/page.tsx",
		fallbackComponent: "DashboardPageLoading",
		contentComponent: "DashboardPageContent",
		fallbackFrameClass: "@container/main flex flex-1 flex-col gap-2",
		fallbackAriaLabel: "Loading dashboard",
		fallbackNestedSkeletonComponent: "SectionCardsSkeleton",
		fallbackNestedSkeletonFile: "src/components/section-cards.tsx",
		fallbackNestedSkeletonItems: 8,
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/today/page.tsx",
		fallbackComponent: "TodayPageLoading",
		fallbackComponentFile: "src/app/[locale]/(app)/today/today-loading.tsx",
		contentComponent: "TodayPageContent",
		fallbackAriaLabel: "Loading today's manager briefing",
		resolvedComponentFile: "src/app/[locale]/(app)/today/today-briefing.tsx",
		resolvedComponent: "TodayBriefing",
		resolvedOuterFrameClass:
			"@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6",
		fallbackGeometryGroups: [
			{
				keyArray: "TODAY_SUMMARY_LOADING_KEYS",
				itemCount: 6,
				frameClass: "grid gap-3 sm:grid-cols-2 xl:grid-cols-6",
			},
			{
				keyArray: "TODAY_ACTION_LOADING_KEYS",
				itemCount: 2,
				frameClass:
					"grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]",
			},
			{
				keyArray: "TODAY_SUPPORTING_LOADING_KEYS",
				itemCount: 5,
				frameClass: "grid gap-4 md:grid-cols-2 xl:grid-cols-3",
			},
		],
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/scheduling/page.tsx",
		fallbackComponent: "SchedulingPageLoading",
		contentComponent: "SchedulingPageContent",
		fallbackFrameClass: "@container/main flex flex-1 flex-col gap-2",
		fallbackAriaLabel: "Loading shift schedule",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/travel-expenses/page.tsx",
		fallbackComponent: "TravelExpensesPageLoading",
		contentComponent: "TravelExpensesPageContent",
		fallbackFrameClass:
			"@container/main flex flex-1 flex-col gap-4 py-4 md:py-6",
		fallbackAriaLabel: "Loading travel expenses",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/my-requests/page.tsx",
		fallbackComponent: "MyRequestsPageLoading",
		contentComponent: "MyRequestsPageContent",
		fallbackAriaLabel: "Loading your requests",
		resolvedComponentFile:
			"src/app/[locale]/(app)/my-requests/my-requests-client.tsx",
		resolvedComponent: "MyRequestsClient",
		resolvedOuterFrameClass:
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/reports/page.tsx",
		fallbackComponent: "ReportsPageLoading",
		contentComponent: "ReportsPageContent",
		fallbackFrameClass:
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		fallbackAriaLabel: "Loading employee reports",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/reports/projects/page.tsx",
		fallbackComponent: "ProjectReportsPageLoading",
		contentComponent: "ProjectReportsPageContent",
		fallbackFrameClass:
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		fallbackAriaLabel: "Loading project reports",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(admin)/platform-admin/page.tsx",
		fallbackComponent: "AdminDashboardLoading",
		contentComponent: "AdminDashboardContent",
		fallbackFrameClass: "space-y-10",
		fallbackAriaLabel: "Loading platform admin overview",
		fallbackGeometryGroups: [
			{
				component: "DashboardStatsLoading",
				keyArray: "DASHBOARD_STATS_LOADING_KEYS",
				itemCount: 4,
				frameClass: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
			},
		],
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(admin)/platform-admin/analytics/page.tsx",
		fallbackComponent: "PlatformAnalyticsPageLoading",
		contentComponent: "PlatformAnalyticsPageContent",
		fallbackFrameClass: "space-y-8",
		fallbackAriaLabel: "Loading platform analytics",
		fallbackGeometryGroups: [
			{
				component: "PlatformAnalyticsLoading",
				keyArray: "PLATFORM_ANALYTICS_KPI_LOADING_KEYS",
				itemCount: 4,
				frameClass: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
			},
			{
				component: "PlatformAnalyticsLoading",
				keyArray: "PLATFORM_ANALYTICS_CHART_LOADING_KEYS",
				itemCount: 2,
				frameClass: "grid gap-4 xl:grid-cols-2",
			},
		],
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(admin)/platform-admin/billing/page.tsx",
		fallbackComponent: "AdminBillingPageLoading",
		contentComponent: "AdminBillingPageContent",
		fallbackFrameClass: "space-y-10",
		fallbackAriaLabel: "Loading platform billing",
		fallbackGeometryGroups: [
			{
				component: "BillingStatsLoading",
				keyArray: "BILLING_STATS_LOADING_KEYS",
				itemCount: 6,
				frameClass: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
			},
			{
				component: "SubscriptionsTableLoading",
				keyArray: "SUBSCRIPTIONS_LOADING_KEYS",
				itemCount: 5,
				frameClass: "p-6 space-y-3",
			},
		],
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx",
		fallbackComponent: "PlatformDiagnosticsPageLoading",
		contentComponent: "PlatformDiagnosticsPageContent",
		fallbackFrameClass: "space-y-10",
		fallbackAriaLabel: "Loading deployment diagnostics",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx",
		fallbackComponent: "WorkerQueueLoading",
		contentComponent: "WorkerQueueContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading worker queue",
		fallbackGeometryGroups: [
			{
				keyArray: "QUEUE_LOADING_KEYS",
				itemCount: 6,
				frameClass: "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
			},
			{
				keyArray: "RELIABILITY_LOADING_KEYS",
				itemCount: 4,
				frameClass: "grid gap-4 md:grid-cols-2 lg:grid-cols-4",
			},
		],
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(auth)/verify-2fa/page.tsx",
		fallbackComponent: "Verify2FAPageLoading",
		contentComponent: "Verify2FAPageContent",
		fallbackFrameClass: "mx-auto w-full max-w-md",
		fallbackAriaLabel: "Loading two-factor verification",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/audit-export/page.tsx",
		fallbackComponent: "AuditExportSettingsLoading",
		contentComponent: "AuditExportSettingsContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading audit export settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/coverage-rules/page.tsx",
		fallbackComponent: "CoverageRulesSettingsLoading",
		contentComponent: "CoverageRulesSettingsContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading coverage rule settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/demo/page.tsx",
		fallbackComponent: "DemoSettingsLoading",
		contentComponent: "DemoSettingsContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading demo data settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/export-operations/page.tsx",
		fallbackComponent: "ExportOperationsPageLoading",
		contentComponent: "ExportOperationsPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading export operations",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/export/page.tsx",
		fallbackComponent: "ExportSettingsLoading",
		contentComponent: "ExportSettingsContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading data export settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/import/[batchId]/page.tsx",
		fallbackComponent: "ImportReviewRouteLoading",
		contentComponent: "ImportReviewRouteContent",
		fallbackFrameClass: "p-6",
		fallbackAriaLabel: "Loading import review",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/import/page.tsx",
		fallbackComponent: "ImportPageLoading",
		contentComponent: "ImportPageContent",
		fallbackFrameClass: "p-6",
		fallbackAriaLabel: "Loading import settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/payroll-export/page.tsx",
		fallbackComponent: "PayrollExportLoading",
		contentComponent: "PayrollExportContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading payroll export settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/scheduled-exports/page.tsx",
		fallbackComponent: "ScheduledExportsLoading",
		contentComponent: "ScheduledExportsContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading scheduled exports",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/analytics/layout.tsx",
		fallbackComponent: "AnalyticsLayoutLoading",
		contentComponent: "AnalyticsLayoutContent",
		fallbackFrameClass:
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		fallbackAriaLabel: "Loading analytics navigation",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(auth)/layout.tsx",
		fallbackComponent: "AuthLayoutLoading",
		contentComponent: "AuthLayoutContent",
		fallbackFrameClass: "relative min-h-svh overflow-x-hidden bg-background",
		fallbackAriaLabel: "Loading authentication",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/onboarding/layout.tsx",
		fallbackComponent: "OnboardingLayoutLoading",
		contentComponent: "OnboardingLayoutContent",
		fallbackFrameClass: "relative min-h-svh overflow-x-hidden bg-background",
		fallbackAriaLabel: "Loading onboarding",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/payroll/page.tsx",
		fallbackComponent: "PayrollPageLoading",
		contentComponent: "PayrollPageContent",
		fallbackFrameClass: "@container/main flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading payroll workspace",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/absences/page.tsx",
		fallbackComponent: "AbsencesPageLoading",
		contentComponent: "AbsencesPageContent",
		fallbackFrameClass:
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		fallbackAriaLabel: "Loading absences",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/works-council/page.tsx",
		fallbackComponent: "WorksCouncilPageLoading",
		contentComponent: "WorksCouncilPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading Works Council portal",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/wellness/page.tsx",
		fallbackComponent: "WellnessPageLoading",
		contentComponent: "WellnessPageContent",
		fallbackFrameClass: "p-6",
		fallbackAriaLabel: "Loading wellness settings",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
		fallbackComponent: "PayrollReadinessPageLoading",
		contentComponent: "PayrollReadinessPageContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-6 p-4 md:p-6",
		fallbackAriaLabel: "Loading payroll readiness",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
		fallbackComponent: "EmployeeAllowancesLoading",
		contentComponent: "EmployeeAllowancesContent",
		fallbackFrameClass: "flex flex-1 flex-col gap-4 p-4",
		fallbackAriaLabel: "Loading employee vacation allowances",
		requiresSynchronousDefaultExport: true,
	},
	{
		file: "src/app/[locale]/(setup)/setup/page.tsx",
		fallbackComponent: "SetupPageLoading",
		contentComponent: "SetupPageContent",
		fallbackFrameClass: "w-full max-w-md",
		fallbackAriaLabel: "Loading platform setup",
		requiresSynchronousDefaultExport: true,
	},
] as const;

type QualityReviewedShellRoute = Extract<
	(typeof SHELL_WORK_QUEUE)[number],
	{ fallbackAriaLabel: string }
>;

type CrossFileResolvedShellRoute = Extract<
	(typeof SHELL_WORK_QUEUE)[number],
	{ resolvedComponentFile: string }
>;

const QUALITY_REVIEWED_SHELL_ROUTES = SHELL_WORK_QUEUE.filter(
	(route): route is QualityReviewedShellRoute => "fallbackAriaLabel" in route,
);

const CROSS_FILE_RESOLVED_SHELL_ROUTES = SHELL_WORK_QUEUE.filter(
	(route): route is CrossFileResolvedShellRoute =>
		"resolvedComponentFile" in route,
);

function appPath(file: string): string {
	return join(APP_ROOT, file.replace(/^src\/app\//, ""));
}

function getFallbackSource(
	route: QualityReviewedShellRoute,
	routeSource: string,
): string {
	return "fallbackComponentFile" in route
		? readFileSync(appPath(route.fallbackComponentFile), "utf8")
		: routeSource;
}

function normalizeGlobPath(file: string): string {
	return file.replaceAll("\\", "/");
}

function maskComments(source: string): string {
	let result = "";
	let index = 0;
	let quote: '"' | "'" | "`" | undefined;

	while (index < source.length) {
		const character = source[index];
		const nextCharacter = source[index + 1];

		if (quote) {
			result += character;
			if (character === "\\") {
				index += 1;
				result += source[index] ?? "";
			} else if (character === quote) {
				quote = undefined;
			}
			index += 1;
			continue;
		}

		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			result += character;
			index += 1;
			continue;
		}

		if (character === "/" && nextCharacter === "/") {
			result += "  ";
			index += 2;
			while (index < source.length && source[index] !== "\n") {
				result += " ";
				index += 1;
			}
			continue;
		}

		if (character === "/" && nextCharacter === "*") {
			result += "  ";
			index += 2;
			while (index < source.length) {
				if (source[index] === "*" && source[index + 1] === "/") {
					result += "  ";
					index += 2;
					break;
				}
				result += source[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			continue;
		}

		result += character;
		index += 1;
	}

	return result;
}

function maskStrings(source: string): string {
	let result = "";
	let index = 0;

	while (index < source.length) {
		const quote = source[index];
		if (quote !== '"' && quote !== "'" && quote !== "`") {
			result += quote;
			index += 1;
			continue;
		}

		result += " ";
		index += 1;
		while (index < source.length) {
			const character = source[index];
			result += character === "\n" ? "\n" : " ";
			index += 1;
			if (character === "\\") {
				result += source[index] === "\n" ? "\n" : " ";
				index += 1;
			} else if (character === quote) {
				break;
			}
		}
	}

	return result;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasImportedConnectionCall(source: string): boolean {
	const sourceWithoutComments = maskComments(source);
	const localIdentifiers: string[] = [];
	const namedNextServerImport =
		/\bimport\s*\{([^}]*)\}\s*from\s*(["'])next\/server\2/g;

	for (const match of sourceWithoutComments.matchAll(namedNextServerImport)) {
		for (const specifier of match[1].split(",")) {
			const connectionImport = specifier.match(
				/^\s*connection(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/,
			);
			if (connectionImport) {
				localIdentifiers.push(connectionImport[1] ?? "connection");
			}
		}
	}

	const callableSource = maskStrings(sourceWithoutComments);
	return localIdentifiers.some((identifier) =>
		new RegExp(`(?<![\\w$.])${escapeRegExp(identifier)}\\s*\\(`).test(
			callableSource,
		),
	);
}

function findJsxOpeningTagEnd(
	source: string,
	start: number,
): number | undefined {
	let braceDepth = 0;

	for (let index = start; index < source.length; index += 1) {
		if (source[index] === "{") {
			braceDepth += 1;
		} else if (source[index] === "}") {
			braceDepth -= 1;
		} else if (source[index] === ">" && braceDepth === 0) {
			return index + 1;
		}
	}

	return undefined;
}

function findMatchingSuspenseClose(
	source: string,
	openingTagEnd: number,
): number | undefined {
	const suspenseTag = /<\/?Suspense\b/g;
	suspenseTag.lastIndex = openingTagEnd;
	let depth = 1;

	for (const match of source.matchAll(suspenseTag)) {
		if (match[0].startsWith("</")) {
			depth -= 1;
			if (depth === 0) {
				return match.index;
			}
		} else {
			depth += 1;
		}
	}

	return undefined;
}

function findNamedFunctionBody(
	source: string,
	functionName: string,
): string | undefined {
	const searchableSource = maskStrings(maskComments(source));
	const declarationPattern = new RegExp(
		`\\bfunction\\s+${escapeRegExp(functionName)}\\s*\\([^)]*\\)\\s*\\{`,
	);
	const declaration = declarationPattern.exec(searchableSource);

	if (!declaration) return undefined;

	const openingBrace = declaration.index + declaration[0].lastIndexOf("{");
	let depth = 1;

	for (
		let index = openingBrace + 1;
		index < searchableSource.length;
		index += 1
	) {
		if (searchableSource[index] === "{") {
			depth += 1;
		} else if (searchableSource[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				return source.slice(openingBrace + 1, index);
			}
		}
	}

	return undefined;
}

function hasFocusedSuspenseBoundary(
	source: string,
	{
		fallbackComponent,
		contentComponent,
	}: { fallbackComponent: string; contentComponent: string },
): boolean {
	const searchableSource = maskStrings(maskComments(source));
	const suspenseOpening = /<Suspense\b/g;
	const fallbackPattern = new RegExp(
		`\\bfallback\\s*=\\s*\\{\\s*<${escapeRegExp(fallbackComponent)}\\s*\\/>\\s*\\}`,
	);
	const contentPattern = new RegExp(`<${escapeRegExp(contentComponent)}\\b`);

	for (const match of searchableSource.matchAll(suspenseOpening)) {
		const openingTagEnd = findJsxOpeningTagEnd(searchableSource, match.index);
		if (!openingTagEnd) continue;

		const openingTag = searchableSource.slice(match.index, openingTagEnd);
		if (!fallbackPattern.test(openingTag)) continue;

		const closingTagStart = findMatchingSuspenseClose(
			searchableSource,
			openingTagEnd,
		);
		if (!closingTagStart) continue;

		if (
			contentPattern.test(
				searchableSource.slice(openingTagEnd, closingTagStart),
			)
		) {
			return true;
		}
	}

	return false;
}

function hasDefaultExportFocusedSuspenseBoundary(
	source: string,
	boundary: { fallbackComponent: string; contentComponent: string },
): boolean {
	const searchableSource = maskStrings(maskComments(source));
	const defaultExport = searchableSource.match(
		/\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
	);
	const defaultExportBody = defaultExport
		? findNamedFunctionBody(source, defaultExport[1])
		: undefined;

	return defaultExportBody
		? hasFocusedSuspenseBoundary(defaultExportBody, boundary)
		: false;
}

function hasSynchronousDefaultExport(source: string): boolean {
	const searchableSource = maskStrings(maskComments(source));

	return /\bexport\s+default\s+function\s+[A-Za-z_$][\w$]*\s*\(/.test(
		searchableSource,
	);
}

function hasExpectedLoadingFrame(
	source: string,
	{
		fallbackComponent,
		fallbackAriaLabel,
		expectedOuterFrameClass,
		fallbackNestedSkeletonComponent,
	}: {
		fallbackComponent: string;
		fallbackAriaLabel: string;
		expectedOuterFrameClass: string;
		fallbackNestedSkeletonComponent?: string;
	},
): boolean {
	const fallbackBody = findNamedFunctionBody(source, fallbackComponent);
	const outerElement = fallbackBody?.match(/<div\b[^>]*>/)?.[0];

	if (!fallbackBody || !outerElement) return false;

	const skeletons = [...fallbackBody.matchAll(/<Skeleton\b[^>]*>/g)];
	const hasHiddenSkeletonContent = fallbackNestedSkeletonComponent
		? new RegExp(
				`<${escapeRegExp(fallbackNestedSkeletonComponent)}\\b[^>]*aria-hidden="true"[^>]*/>`,
			).test(fallbackBody)
		: skeletons.length > 0 &&
			skeletons.every(([skeleton]) => skeleton.includes('aria-hidden="true"'));

	return (
		outerElement.includes(`className="${expectedOuterFrameClass}"`) &&
		outerElement.includes('role="status"') &&
		outerElement.includes(`aria-label="${fallbackAriaLabel}"`) &&
		hasHiddenSkeletonContent
	);
}

function hasExpectedNestedSkeletonGeometry(
	routeSource: string,
	nestedSource: string,
	{
		fallbackComponent,
		fallbackNestedSkeletonComponent,
		fallbackNestedSkeletonItems,
	}: {
		fallbackComponent: string;
		fallbackNestedSkeletonComponent: string;
		fallbackNestedSkeletonItems: number;
	},
): boolean {
	const fallbackBody = findNamedFunctionBody(routeSource, fallbackComponent);
	const nestedItemCount = nestedSource.match(
		/const\s+WIDGET_SKELETON_KEYS\s*=\s*Array\.from\(\s*\{\s*length:\s*(\d+)\s*\}/,
	)?.[1];

	return (
		fallbackBody?.includes(`<${fallbackNestedSkeletonComponent}`) === true &&
		Number(nestedItemCount) === fallbackNestedSkeletonItems
	);
}

function hasExpectedMappedLoadingGeometry(
	source: string,
	fallbackComponent: string,
	groups: readonly {
		component?: string;
		keyArray: string;
		itemCount: number;
		frameClass: string;
	}[],
): boolean {
	const fallbackBody = findNamedFunctionBody(source, fallbackComponent);
	if (!fallbackBody) return false;

	return groups.every(({ component, keyArray, itemCount, frameClass }) => {
		if (
			component &&
			!new RegExp(`<${escapeRegExp(component)}\\b`).test(
				maskStrings(maskComments(fallbackBody)),
			)
		) {
			return false;
		}

		const geometryBody = findNamedFunctionBody(
			source,
			component ?? fallbackComponent,
		);
		if (!geometryBody) return false;
		const keyArrayPattern = new RegExp(
			`const\\s+${escapeRegExp(keyArray)}\\s*=\\s*\\[([^\\]]*)\\]`,
		);
		const arrayBody = source.match(keyArrayPattern)?.[1];
		const keys = arrayBody?.match(/["'][^"']+["']/g) ?? [];

		return (
			keys.length === itemCount &&
			geometryBody.includes(`className="${frameClass}"`) &&
			geometryBody.includes(`${keyArray}.map`)
		);
	});
}

function hasExpectedResolvedOuterFrame(
	source: string,
	{
		resolvedComponent,
		resolvedOuterFrameClass,
	}: {
		resolvedComponent: string;
		resolvedOuterFrameClass: string;
	},
): boolean {
	const resolvedBody = findNamedFunctionBody(source, resolvedComponent);
	const outerElement = resolvedBody?.match(/<div\b[^>]*>/)?.[0];

	return (
		outerElement?.includes(`className="${resolvedOuterFrameClass}"`) ?? false
	);
}

function expectedOuterFrameClass(route: QualityReviewedShellRoute): string {
	return "resolvedOuterFrameClass" in route
		? route.resolvedOuterFrameClass
		: route.fallbackFrameClass;
}

describe("connection call source detection", () => {
	it.each([
		['import { connection } from "next/server"; await connection();', true],
		[
			'import { connection as waitForRequest } from "next/server"; await waitForRequest();',
			true,
		],
		[
			'import { connection } from "next/server"; // connection()\nreturn null;',
			false,
		],
		['import { connection } from "next/server"; database.connection();', false],
		[
			'import { connection } from "next/server"; const text = "connection()";',
			false,
		],
		['import { connection } from "next/server"; return null;', false],
		["await connection();", false],
	])("detects only an imported direct call in %#", (source, expected) => {
		expect(hasImportedConnectionCall(source)).toBe(expected);
	});

	it("normalizes platform-specific glob separators", () => {
		expect(normalizeGlobPath("[locale]\\(app)\\page.tsx")).toBe(
			"[locale]/(app)/page.tsx",
		);
	});
});

describe("focused Suspense boundary detection", () => {
	const boundary = {
		fallbackComponent: "RouteLoading",
		contentComponent: "RouteContent",
	};

	it("accepts a named fallback wrapping the expected content", () => {
		expect(
			hasFocusedSuspenseBoundary(
				"<Suspense fallback={<RouteLoading />}><RouteContent /></Suspense>",
				boundary,
			),
		).toBe(true);
	});

	it("requires the focused boundary to be returned by the default export", () => {
		expect(
			hasDefaultExportFocusedSuspenseBoundary(
				"export default function Page() { return <Suspense fallback={<RouteLoading />}><RouteContent /></Suspense>; }",
				boundary,
			),
		).toBe(true);
	});

	it("rejects a focused boundary disconnected from the default export", () => {
		const source = `
			function Disconnected() {
				return <Suspense fallback={<RouteLoading />}><RouteContent /></Suspense>;
			}
			export default function Page() { return <Other />; }
		`;

		expect(hasFocusedSuspenseBoundary(source, boundary)).toBe(true);
		expect(hasDefaultExportFocusedSuspenseBoundary(source, boundary)).toBe(
			false,
		);
	});

	it.each([
		"<Suspense fallback={<><RouteLoading /></>}><RouteContent /></Suspense>",
		"<Suspense><Other /></Suspense><div fallback={<RouteLoading />}><RouteContent /></div>",
		"<Suspense fallback={null}><RouteContent /></Suspense>",
		"<Suspense fallback={<RouteLoading />}><Other /></Suspense><RouteContent />",
	])("rejects an invalid boundary in %#", (source) => {
		expect(hasFocusedSuspenseBoundary(source, boundary)).toBe(false);
	});
});

describe("loading frame alignment", () => {
	it("rejects a fallback frame that differs from the resolved component frame", () => {
		const fallbackSource = `
			function RouteLoading() {
				return <div className="declared-frame" role="status" aria-label="Loading route"><Skeleton aria-hidden="true" /></div>;
			}
		`;
		const resolvedSource = `
			function RouteContent() {
				return <div className="resolved-frame">Content</div>;
			}
		`;

		expect(
			hasExpectedResolvedOuterFrame(resolvedSource, {
				resolvedComponent: "RouteContent",
				resolvedOuterFrameClass: "resolved-frame",
			}),
		).toBe(true);
		expect(
			hasExpectedLoadingFrame(fallbackSource, {
				fallbackComponent: "RouteLoading",
				fallbackAriaLabel: "Loading route",
				expectedOuterFrameClass: "resolved-frame",
			}),
		).toBe(false);
	});

	it("rejects mapped loading geometry with the wrong item count", () => {
		const source = `
			const SUMMARY_KEYS = ["one", "two"] as const;
			function RouteLoading() {
				return <div className="summary-grid">{SUMMARY_KEYS.map((key) => <Skeleton key={key} />)}</div>;
			}
		`;

		expect(
			hasExpectedMappedLoadingGeometry(source, "RouteLoading", [
				{
					keyArray: "SUMMARY_KEYS",
					itemCount: 3,
					frameClass: "summary-grid",
				},
			]),
		).toBe(false);
	});

	it("rejects dead nested geometry that is not rendered by the reachable fallback", () => {
		const source = `
			const SUMMARY_KEYS = ["one", "two"] as const;
			function DeadSummaryLoading() {
				return <div className="summary-grid">{SUMMARY_KEYS.map((key) => <Skeleton key={key} />)}</div>;
			}
			function RouteLoading() {
				return <DifferentLoading />;
			}
			export default function Page() {
				return <Suspense fallback={<RouteLoading />}><RouteContent /></Suspense>;
			}
		`;

		expect(
			hasDefaultExportFocusedSuspenseBoundary(source, {
				fallbackComponent: "RouteLoading",
				contentComponent: "RouteContent",
			}),
		).toBe(true);
		expect(
			hasExpectedMappedLoadingGeometry(source, "RouteLoading", [
				{
					component: "DeadSummaryLoading",
					keyArray: "SUMMARY_KEYS",
					itemCount: 2,
					frameClass: "summary-grid",
				},
			]),
		).toBe(false);
	});
});

describe("App Router connection escape hatches", () => {
	it("keeps the pending inventory empty and the retained inventory exact", () => {
		expect(PENDING_CONNECTION_FILES).toHaveLength(0);
		expect(REVIEWED_RETAINED_CONNECTION_FILES).toHaveLength(10);
	});

	it("matches the reviewed and pending page/layout inventory exactly", () => {
		const actualFiles = globSync("**/{page,layout}.tsx", { cwd: APP_ROOT })
			.filter((file) =>
				hasImportedConnectionCall(readFileSync(join(APP_ROOT, file), "utf8")),
			)
			.map((file) => `src/app/${normalizeGlobPath(file)}`)
			.sort();
		const retainedFiles = [...REVIEWED_RETAINED_CONNECTION_FILES].sort();
		const pendingFiles = [...PENDING_CONNECTION_FILES].sort();
		const overlap = retainedFiles.filter((file) => pendingFiles.includes(file));

		expect(overlap).toEqual([]);
		expect([...retainedFiles, ...pendingFiles].sort()).toEqual(actualFiles);
	});

	it("lists only files that exist", () => {
		for (const file of [
			...REVIEWED_RETAINED_CONNECTION_FILES,
			...PENDING_CONNECTION_FILES,
		]) {
			expect(existsSync(appPath(file)), file).toBe(true);
		}
	});

	it.each(REVIEWED_RETAINED_CONNECTION_BOUNDARIES)(
		"keeps an approved reachable request boundary in $file",
		(boundary) => {
			const source = readFileSync(appPath(boundary.file), "utf8");
			const contentBody = findNamedFunctionBody(
				source,
				boundary.contentComponent,
			);
			const reasonAndOperation = `// ${boundary.reason}\n\tawait connection();\n\t${boundary.operation}`;

			expect(
				APPROVED_CONNECTION_REASON_CATEGORIES.has(boundary.reasonCategory),
			).toBe(true);
			expect(hasImportedConnectionCall(source), boundary.file).toBe(true);
			expect(contentBody, boundary.file).toContain(reasonAndOperation);
			expect(
				hasDefaultExportFocusedSuspenseBoundary(source, boundary),
				boundary.file,
			).toBe(true);
		},
	);
});

describe("low-risk route streaming boundaries", () => {
	it("registers every shell work queue route exactly once", () => {
		const workQueueFiles = SHELL_WORK_QUEUE.map(({ file }) => file);

		expect(workQueueFiles).toHaveLength(64);
		expect(new Set(workQueueFiles).size).toBe(workQueueFiles.length);
	});

	it.each(SHELL_WORK_QUEUE)(
		"keeps a focused Suspense fallback in $file",
		(route) => {
			const { file } = route;
			const source = readFileSync(appPath(file), "utf8");

			expect(hasFocusedSuspenseBoundary(source, route), file).toBe(true);
		},
	);

	it.each(QUALITY_REVIEWED_SHELL_ROUTES)(
		"keeps an aligned accessible loading frame in $file",
		(route) => {
			const source = readFileSync(appPath(route.file), "utf8");
			const fallbackSource = getFallbackSource(route, source);

			expect(
				hasDefaultExportFocusedSuspenseBoundary(source, route),
				route.file,
			).toBe(true);
			expect(
				hasExpectedLoadingFrame(fallbackSource, {
					...route,
					expectedOuterFrameClass: expectedOuterFrameClass(route),
				}),
				route.file,
			).toBe(true);
		},
	);

	it.each(CROSS_FILE_RESOLVED_SHELL_ROUTES)(
		"derives the fallback frame from resolved content in $file",
		(route) => {
			const resolvedSource = readFileSync(
				appPath(route.resolvedComponentFile),
				"utf8",
			);

			expect(
				hasExpectedResolvedOuterFrame(resolvedSource, route),
				route.resolvedComponentFile,
			).toBe(true);
		},
	);

	it.each(
		SHELL_WORK_QUEUE.filter(
			(route) => "fallbackNestedSkeletonComponent" in route,
		),
	)("reuses the reviewed feature skeleton geometry in $file", (route) => {
		const source = readFileSync(appPath(route.file), "utf8");
		const nestedSource = readFileSync(
			join(APP_ROOT, "../..", route.fallbackNestedSkeletonFile),
			"utf8",
		);

		expect(
			hasExpectedNestedSkeletonGeometry(source, nestedSource, route),
			route.file,
		).toBe(true);
	});

	it.each(
		SHELL_WORK_QUEUE.filter((route) => "fallbackGeometryGroups" in route),
	)("keeps meaningful loading geometry in $file", (route) => {
		const source = readFileSync(appPath(route.file), "utf8");
		const fallbackSource =
			"fallbackComponentFile" in route
				? readFileSync(appPath(route.fallbackComponentFile), "utf8")
				: source;

		expect(
			hasExpectedMappedLoadingGeometry(
				fallbackSource,
				route.fallbackComponent,
				route.fallbackGeometryGroups,
			),
			route.file,
		).toBe(true);
	});

	it.each(
		SHELL_WORK_QUEUE.filter(
			(route) =>
				"requiresSynchronousDefaultExport" in route &&
				route.requiresSynchronousDefaultExport,
		),
	)(
		"keeps request reads behind the default export boundary in $file",
		(route) => {
			const source = readFileSync(appPath(route.file), "utf8");

			expect(hasSynchronousDefaultExport(source), route.file).toBe(true);
		},
	);
});
