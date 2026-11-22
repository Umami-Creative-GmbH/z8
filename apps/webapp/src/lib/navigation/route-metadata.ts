import { z } from "zod";
import { SETTINGS_ENTRIES } from "@/components/settings/settings-config";
import { ALL_LANGUAGES } from "@/tolgee/catalog-config";

export type AppRouteMetadata = {
	id: string;
	href: string;
	titleKey: string;
	titleDefault: string;
};

export const APP_ROUTE_METADATA: readonly AppRouteMetadata[] = [
	{
		id: "dashboard",
		href: "/",
		titleKey: "nav.dashboard",
		titleDefault: "Dashboard",
	},
	{ id: "today", href: "/today", titleKey: "nav.today", titleDefault: "Today" },
	// Covers the employee and assignment pages below it (#1572). Both equipment
	// titles show their English default until `tolgee sync` adds the `nav` keys.
	{
		id: "equipment",
		href: "/equipment",
		titleKey: "nav.equipment",
		titleDefault: "Equipment",
	},
	{
		id: "my-equipment",
		href: "/my-equipment",
		titleKey: "nav.my-equipment",
		titleDefault: "My equipment",
	},
	{
		id: "notifications",
		href: "/notifications",
		titleKey: "notifications.title",
		titleDefault: "Notifications",
	},
	{
		id: "calendar",
		href: "/calendar",
		titleKey: "nav.calendar",
		titleDefault: "Calendar",
	},
	{
		id: "time-tracking",
		href: "/time-tracking",
		titleKey: "nav.time-tracking",
		titleDefault: "Time Tracking",
	},
	{
		id: "my-requests",
		href: "/my-requests",
		titleKey: "nav.my-requests",
		titleDefault: "My Requests",
	},
	{
		id: "org-explorer",
		href: "/organization",
		titleKey: "nav.org-explorer",
		titleDefault: "Org Explorer",
	},
	{
		id: "absences",
		href: "/absences",
		titleKey: "nav.absences",
		titleDefault: "Absences",
	},
	{
		id: "travel-expenses",
		href: "/travel-expenses",
		titleKey: "nav.travel-expenses",
		titleDefault: "Travel Expenses",
	},
	// Route titles must exist in the synced catalogs, so both driving licence routes keep synced
	// keys until `nav.my-driving-licence` and `nav.team-driving-licences` are synced (#1937).
	{
		id: "driving-licence",
		href: "/driving-licence",
		titleKey: "drivingLicence.myTitle",
		titleDefault: "My driving authorization",
	},
	{
		id: "reports-projects",
		href: "/reports/projects",
		titleKey: "reports.projects.title",
		titleDefault: "Project Reports",
	},
	{
		id: "reports-vehicles",
		href: "/reports/vehicles",
		titleKey: "reports.vehicles.title",
		titleDefault: "Distance per Vehicle",
	},
	{
		id: "reports",
		href: "/reports",
		titleKey: "nav.reports",
		titleDefault: "Reports",
	},
	{
		id: "team-absences",
		href: "/team/absences",
		titleKey: "nav.teamAbsences",
		titleDefault: "Team Absences",
	},
	{
		id: "team-presence",
		href: "/team/presence",
		titleKey: "nav.teamPresence",
		titleDefault: "Who Is In",
	},
	{
		id: "team-period-submissions",
		href: "/team/period-submissions",
		titleKey: "nav.teamPeriodSubmissions",
		titleDefault: "Period Submissions",
	},
	{
		id: "team-driving-licence",
		href: "/team/driving-licence",
		titleKey: "nav.driving-licence",
		titleDefault: "Driving licence",
	},
	{
		id: "team-driving",
		href: "/team/driving",
		titleKey: "nav.teamDriving",
		titleDefault: "Driving Details",
	},
	{ id: "team", href: "/team", titleKey: "nav.team", titleDefault: "Team" },
	{
		id: "approvals",
		href: "/approvals",
		titleKey: "nav.approvals",
		titleDefault: "Approvals",
	},
	{
		id: "analytics",
		href: "/analytics",
		titleKey: "nav.analytics",
		titleDefault: "Analytics",
	},
	{
		id: "payroll",
		href: "/payroll",
		titleKey: "nav.payroll",
		titleDefault: "Payroll",
	},
	{
		id: "scheduling",
		href: "/scheduling",
		titleKey: "nav.scheduling",
		titleDefault: "Scheduling",
	},
	{
		id: "compliance",
		href: "/compliance",
		titleKey: "nav.compliance",
		titleDefault: "Compliance",
	},
	{
		id: "works-council",
		href: "/works-council",
		titleKey: "nav.worksCouncil",
		titleDefault: "Works Council",
	},
	{
		id: "billing-suspended",
		href: "/billing/suspended",
		titleKey: "settings.billing.title",
		titleDefault: "Billing & Subscription",
	},
	// Equipment's and Approval's new titles still need Tolgee sync. Until then the
	// shell uses their catalog-backed Settings ancestor; the page/nav have dedicated defaults.
	...SETTINGS_ENTRIES.filter(
		(entry) => entry.id !== "equipment" && entry.id !== "approval",
	).map(
		(entry) => ({
			id: `settings-${entry.id}`,
			href: entry.href,
			titleKey: entry.titleKey,
			titleDefault: entry.titleDefault,
		}),
	),
	{
		id: "settings",
		href: "/settings",
		titleKey: "nav.settings",
		titleDefault: "Settings",
	},
] as const;

export const UNKNOWN_ROUTE_METADATA: AppRouteMetadata = {
	id: "unknown",
	href: "",
	titleKey: "common.appName",
	titleDefault: "Z8",
};

export function normalizeAppPath(pathname: string): string {
	const [firstSegment, ...remainingSegments] = pathname
		.split("/")
		.filter(Boolean);
	const segments = ALL_LANGUAGES.includes(
		firstSegment as (typeof ALL_LANGUAGES)[number],
	)
		? remainingSegments
		: [firstSegment, ...remainingSegments].filter(Boolean);
	return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** Settings routes that render their own PageHeader (or SettingsTabbedPage) h1.
 * Redirect-only legacy routes are deliberately absent: they keep the shell title.
 */
const SETTINGS_PAGE_HEADING_ROUTES: ReadonlySet<string> = new Set([
	"/settings",
	"/settings/approval-policies",
	"/settings/audit-export",
	"/settings/avv",
	"/settings/billable-time",
	"/settings/billable-time/accounting",
	"/settings/billable-time/cost-rates",
	"/settings/billable-time/hand-off",
	"/settings/billable-time/rates",
	"/settings/billing",
	"/settings/calendar",
	"/settings/clocking",
	"/settings/closed-months",
	"/settings/compliance",
	"/settings/compliance/works-council",
	"/settings/custom-fields",
	"/settings/customers",
	"/settings/demo",
	"/settings/driving-licence",
	"/settings/employees",
	"/settings/enterprise/api-keys",
	"/settings/enterprise/domains",
	"/settings/enterprise/email",
	"/settings/enterprise/identity-setup",
	"/settings/equipment",
	"/settings/export",
	"/settings/export-operations",
	"/settings/implementation-checklist",
	"/settings/import",
	"/settings/kiosks",
	"/settings/locations",
	"/settings/my-data",
	"/settings/notification-channels",
	"/settings/notifications",
	"/settings/organization",
	"/settings/payroll-access",
	"/settings/payroll-export",
	"/settings/payroll-readiness",
	"/settings/permissions",
	"/settings/personnel-files",
	"/settings/position-capture",
	"/settings/position-stamps",
	"/settings/profile",
	"/settings/projects",
	"/settings/report-share-links",
	"/settings/roles",
	"/settings/scheduled-exports",
	"/settings/security",
	"/settings/shifts",
	"/settings/skills",
	"/settings/statistics",
	"/settings/surcharges",
	"/settings/teams",
	"/settings/travel-expenses",
	"/settings/vacation",
	"/settings/vacation/employees",
	"/settings/vehicles",
	"/settings/wellness",
	"/settings/work-diagnostics",
	"/settings/work-policies",
]);

/** Settings record pages (one dynamic segment) that render their own h1. */
const SETTINGS_RECORD_HEADING_ROUTES: readonly RegExp[] = [
	// `new` is a redirect-only legacy route and keeps the shell title.
	/^\/settings\/employees\/(?!new$)[^/]+$/,
	/^\/settings\/teams\/[^/]+$/,
	/^\/settings\/locations\/[^/]+$/,
	/^\/settings\/import\/[^/]+$/,
	/^\/settings\/enterprise\/api-keys\/[^/]+$/,
	/^\/settings\/vacation\/employees\/[^/]+$/,
	/^\/settings\/export\/history\/[^/]+$/,
];

/** Exact opt-ins only: adopt a page heading and update this list atomically.
 * Descendants keep their shell title until their own page ticket converts them.
 */
export function appPageOwnsHeading(pathname: string): boolean {
	const path = normalizeAppPath(pathname);
	const legacyClaimId = /^\/travel-expenses\/([^/]+)$/.exec(path)?.[1];
	const reportId = /^\/travel-expenses\/reports\/([^/]+)$/.exec(path)?.[1];
	return (
		SETTINGS_PAGE_HEADING_ROUTES.has(path) ||
		SETTINGS_RECORD_HEADING_ROUTES.some((pattern) => pattern.test(path)) ||
		path === "/travel-expenses" ||
		path === "/travel-expenses/finance" ||
		Boolean(legacyClaimId && z.uuid().safeParse(legacyClaimId).success) ||
		Boolean(reportId && z.uuid().safeParse(reportId).success) ||
		/^\/team\/presence\/[^/]+$/.test(path) ||
		/^\/personnel-files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			path,
		) ||
		/^\/equipment\/assignments\/[^/]+$/.test(path) ||
		/^\/equipment\/employees\/[^/]+$/.test(path) ||
		/^\/team\/driving-licence\/[^/]+$/.test(path) ||
		/^\/approvals\/review\/[^/]+\/[^/]+\/[^/]+$/.test(path) ||
		/^\/approvals\/deputy-decisions\/[^/]+$/.test(path) ||
		/^\/calendar\/[^/]+$/.test(path) ||
		/^\/payroll\/work-balances\/[^/]+$/.test(path) ||
		/^\/personnel-files\/payslip-batches\/[^/]+$/.test(path) ||
		path === "/" ||
		path === "/time-tracking" ||
		path === "/today" ||
		path === "/team/presence" ||
		path === "/personnel-files/payslip-batches" ||
		path === "/notifications" ||
		path === "/scheduling" ||
		path === "/absences" ||
		path === "/my-requests" ||
		path === "/team" ||
		path === "/team/absences" ||
		path === "/team/driving" ||
		path === "/team/driving-licence" ||
		path === "/team/period-submissions" ||
		path === "/payroll" ||
		path === "/my-documents" ||
		path === "/personnel-files" ||
		path === "/personnel-files/document-requests" ||
		path === "/personnel-files/due-for-deletion" ||
		path === "/personnel-files/sick-leave" ||
		path === "/payroll/work-balances" ||
		path === "/equipment" ||
		path === "/my-equipment" ||
		path === "/organization" ||
		path === "/compliance" ||
		path === "/driving-licence" ||
		path === "/calendar" ||
		path === "/approvals" ||
		path === "/approvals/inbox" ||
		path === "/analytics" ||
		path === "/analytics/overtime-burn-down" ||
		path === "/analytics/team-performance" ||
		path === "/analytics/work-hours" ||
		path === "/analytics/vacation-trends" ||
		path === "/reports" ||
		path === "/reports/projects" ||
		path === "/reports/vehicles" ||
		path === "/billing/suspended"
	);
}

function routeMatches(pathname: string, href: string): boolean {
	if (href === "/") return pathname === "/";
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveAppRouteMetadata(pathname: string): AppRouteMetadata {
	const normalizedPath = normalizeAppPath(pathname);
	return (
		[...APP_ROUTE_METADATA]
			.sort((left, right) => right.href.length - left.href.length)
			.find((route) => routeMatches(normalizedPath, route.href)) ??
		UNKNOWN_ROUTE_METADATA
	);
}
