import {
	IconBeach,
	IconBell,
	IconBriefcase,
	IconCalendar,
	IconCalendarCheck,
	IconCalendarEvent,
	IconCalendarTime,
	IconCar,
	IconCash,
	IconChartBar,
	IconClipboardCheck,
	IconClock,
	IconCreditCard,
	IconDashboard,
	IconFileDescription,
	IconFileInvoice,
	IconFolder,
	IconFolders,
	IconGauge,
	IconGavel,
	IconHelp,
	IconHierarchy,
	IconLicense,
	IconMessageCircle,
	IconPackage,
	IconReceipt,
	IconReport,
	IconReportMoney,
	IconServerCog,
	IconSettings,
	IconShieldCheck,
	IconSteeringWheel,
	IconSun,
	IconUserCheck,
	IconUsers,
} from "@tabler/icons-react";
import type { FeatureFlagState } from "@/components/settings/settings-config";
import {
	MY_DRIVING_LICENCE_PATH,
	TEAM_DRIVING_LICENCE_PATH,
} from "@/lib/organization/driving-licence/paths";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import type { SettingsCapabilities } from "@/lib/settings/capabilities";

export type NavigationIcon = typeof IconDashboard;

export type SidebarSection = "workplace" | "team" | "organization" | "secondary" | "none";

export type NavigationEmployeeRole = "admin" | "manager" | "employee" | null;

export interface NavigationCapabilities {
	scheduling: boolean;
	compliance: boolean;
	payroll: boolean;
	/** Owners, admins and active expense officers (#753). */
	finance: boolean;
	/** Billable Hand-off workspace visibility: org admins while Billable Time and Projects are enabled (#1956). */
	billableHandOff?: boolean;
	worksCouncil: boolean;
	/** The employee's own shared documents while personnel files are on (#865). */
	myDocuments?: boolean;
	/** Current employee self-history; no staff authority. */
	myEquipment?: boolean;
	/** Explicit equipment staff capability; a manager role alone never grants it. */
	equipment?: boolean;
	/** Owners, admins and active personnel file officers while personnel files are on (#866). */
	personnelFiles?: boolean;
	/** Managers and above while the organization collects period submissions (#1075). */
	periodSubmissions?: boolean;
	/** Who Is In is useful only while the active organization has active locations. */
	teamPresence?: boolean;
	/** My driving licence: the feature is on and the viewer is an intended driver or has own records (#1937). */
	myDrivingLicence?: boolean;
	/** Driving licences: the feature is on and the viewer verifies or plans (#1937). */
	teamDrivingLicence?: boolean;
	/** Missing vehicle logs queue visibility (resolved from drivingDetailsTeamScope on the server). */
	missingVehicleLogs?: boolean;
	/** Analytics workspace visibility (managers, workforce admins, and org admins including employee-less org admins; #1955). */
	analytics?: boolean;
	/** Project reports visibility (projectsEnabled and project-report viewer access). */
	projectReports?: boolean;
	platformAdmin: boolean;
}

export interface NavigationAccessContext {
	employeeRole: NavigationEmployeeRole;
	settingsAccess: SettingsAccess | null;
	navigationCapabilities: NavigationCapabilities;
	featureFlags?: FeatureFlagState;
	/** Server-computed non-tier visibility capabilities (ADR 0003). */
	settingsCapabilities?: Partial<SettingsCapabilities>;
}

export interface NavigationSearchKeyword {
	key: string;
	defaultValue: string;
}

export interface NavigationSearchMetadata {
	include: boolean;
	descriptionKey?: string;
	descriptionDefault?: string;
	keywords?: readonly NavigationSearchKeyword[];
}

export interface NavigationManifestEntry {
	id: string;
	href: string;
	/** Optional path prefix used for shell route metadata matching when different from `href`. */
	routeMatchHref?: string;
	titleKey: string;
	titleDefault: string;
	icon: NavigationIcon;
	sidebarSection: SidebarSection;
	external?: boolean;
	badgeId?: "finance";
	/** Whether the page at `href` renders its own h1 heading. */
	ownsHeading: boolean;
	/** Additional exact static subpaths in this route family that render their own h1 heading. */
	ownedHeadingSubpaths?: readonly string[];
	/** Include in APP_ROUTE_METADATA (defaults to `!external`). */
	includeInRouteMetadata?: boolean;
	cmdK: NavigationSearchMetadata;
	isVisible: (ctx: NavigationAccessContext) => boolean;
}

function isManagerOrAdmin(employeeRole: NavigationEmployeeRole): boolean {
	return employeeRole === "admin" || employeeRole === "manager";
}

function canViewMissingVehicleLogs(ctx: NavigationAccessContext): boolean {
	if (ctx.navigationCapabilities.missingVehicleLogs !== undefined) {
		return ctx.navigationCapabilities.missingVehicleLogs;
	}
	return (
		meetsSettingsAccess(ctx.settingsAccess, "orgAdmin") ||
		(meetsSettingsAccess(ctx.settingsAccess, "scopedManager") && ctx.employeeRole !== null)
	);
}

function canViewAnalytics(ctx: NavigationAccessContext): boolean {
	if (ctx.navigationCapabilities.analytics !== undefined) {
		return ctx.navigationCapabilities.analytics;
	}
	return (
		meetsSettingsAccess(ctx.settingsAccess, "scopedManager") || isManagerOrAdmin(ctx.employeeRole)
	);
}

function canViewBillableHandOff(ctx: NavigationAccessContext): boolean {
	if (ctx.navigationCapabilities.billableHandOff !== undefined) {
		return ctx.navigationCapabilities.billableHandOff;
	}
	return (
		meetsSettingsAccess(ctx.settingsAccess, "orgAdmin") &&
		Boolean(ctx.featureFlags?.billableTimeEnabled) &&
		Boolean(ctx.featureFlags?.projectsEnabled)
	);
}

function canViewProjectReports(ctx: NavigationAccessContext): boolean {
	if (ctx.navigationCapabilities.projectReports !== undefined) {
		return ctx.navigationCapabilities.projectReports;
	}
	return (
		Boolean(ctx.featureFlags?.projectsEnabled) &&
		ctx.employeeRole !== null &&
		(meetsSettingsAccess(ctx.settingsAccess, "orgAdmin") ||
			isManagerOrAdmin(ctx.employeeRole) ||
			Boolean(ctx.settingsCapabilities?.canManageProjects))
	);
}

/**
 * Single typed navigation manifest for all top-level and sub-level app destinations
 * (ADR 0003, #1944, #1952). Sidebar sections, Cmd+K static pages and icons, and shell
 * route metadata / heading ownership are derived from this list.
 */
export const APP_NAVIGATION_MANIFEST: readonly NavigationManifestEntry[] = [
	// ── Workplace (personal) ─────────────────────────────────────────────────
	{
		id: "dashboard",
		href: "/",
		titleKey: "nav.dashboard",
		titleDefault: "Dashboard",
		icon: IconDashboard,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "time-tracking",
		href: "/time-tracking",
		titleKey: "nav.time-tracking",
		titleDefault: "Time Tracking",
		icon: IconClock,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "calendar",
		href: "/calendar",
		titleKey: "nav.calendar",
		titleDefault: "Calendar",
		icon: IconCalendarEvent,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "my-schedule",
		href: "/scheduling",
		titleKey: "nav.my-schedule",
		titleDefault: "My Schedule",
		icon: IconCalendarTime,
		sidebarSection: "workplace",
		ownsHeading: true,
		includeInRouteMetadata: false,
		cmdK: { include: true },
		isVisible: (ctx) => ctx.navigationCapabilities.scheduling && ctx.employeeRole === "employee",
	},
	{
		id: "absences",
		href: "/absences",
		titleKey: "nav.absences",
		titleDefault: "Absences",
		icon: IconBeach,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "travel-expenses",
		href: "/travel-expenses",
		titleKey: "nav.travel-expenses",
		titleDefault: "Travel Expenses",
		icon: IconReceipt,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "my-requests",
		href: "/my-requests",
		titleKey: "nav.my-requests",
		titleDefault: "My Requests",
		icon: IconFileDescription,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "my-documents",
		href: "/my-documents",
		titleKey: "nav.my-documents",
		titleDefault: "My Documents",
		icon: IconFolder,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.myDocuments),
	},
	{
		id: "driving-licence",
		href: MY_DRIVING_LICENCE_PATH,
		titleKey: "nav.my-driving-licence",
		titleDefault: "My driving licence",
		icon: IconSteeringWheel,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.myDrivingLicence),
	},
	{
		id: "my-equipment",
		href: "/my-equipment",
		titleKey: "nav.my-equipment",
		titleDefault: "My equipment",
		icon: IconPackage,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.myEquipment),
	},
	{
		id: "reports",
		href: "/reports",
		titleKey: "nav.reports",
		titleDefault: "Reports",
		icon: IconReport,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "org-explorer",
		href: "/organization",
		titleKey: "nav.org-explorer",
		titleDefault: "Org Explorer",
		icon: IconHierarchy,
		sidebarSection: "workplace",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},

	// ── Team & manager oversight ─────────────────────────────────────────────
	{
		id: "today",
		href: "/today",
		titleKey: "nav.today",
		titleDefault: "Today",
		icon: IconSun,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: {
			include: true,
			keywords: [
				{ key: "appSearch.today.keywords.briefing", defaultValue: "briefing" },
				{ key: "appSearch.today.keywords.daily", defaultValue: "daily" },
				{ key: "appSearch.today.keywords.manager", defaultValue: "manager" },
			],
		},
		isVisible: (ctx) => isManagerOrAdmin(ctx.employeeRole),
	},
	{
		id: "team",
		href: "/team",
		titleKey: "nav.team",
		titleDefault: "Team",
		icon: IconUsers,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => isManagerOrAdmin(ctx.employeeRole),
	},
	{
		id: "team-absences",
		href: "/team/absences",
		titleKey: "nav.teamAbsences",
		titleDefault: "Team Absences",
		icon: IconBeach,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: {
			include: true,
			descriptionKey: "appSearch.teamAbsences.description",
			descriptionDefault: "Review employee absence metrics and record absences",
			keywords: [
				{ key: "appSearch.teamAbsences.keywords.team", defaultValue: "team" },
				{ key: "appSearch.teamAbsences.keywords.absence", defaultValue: "absence" },
				{ key: "appSearch.teamAbsences.keywords.sick", defaultValue: "sick" },
				{ key: "appSearch.teamAbsences.keywords.vacation", defaultValue: "vacation" },
				{ key: "appSearch.teamAbsences.keywords.manager", defaultValue: "manager" },
			],
		},
		isVisible: (ctx) => isManagerOrAdmin(ctx.employeeRole),
	},
	{
		id: "team-presence",
		href: "/team/presence",
		titleKey: "nav.teamPresence",
		titleDefault: "Who Is In",
		icon: IconUserCheck,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) =>
			isManagerOrAdmin(ctx.employeeRole) && Boolean(ctx.navigationCapabilities.teamPresence),
	},
	{
		id: "team-period-submissions",
		href: "/team/period-submissions",
		titleKey: "nav.teamPeriodSubmissions",
		titleDefault: "Period Submissions",
		icon: IconCalendarCheck,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) =>
			isManagerOrAdmin(ctx.employeeRole) && Boolean(ctx.navigationCapabilities.periodSubmissions),
	},
	{
		id: "scheduling",
		href: "/scheduling",
		titleKey: "nav.scheduling",
		titleDefault: "Scheduling",
		icon: IconCalendar,
		sidebarSection: "team",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => isManagerOrAdmin(ctx.employeeRole) && ctx.navigationCapabilities.scheduling,
	},
	{
		id: "approvals",
		href: "/approvals/inbox",
		routeMatchHref: "/approvals",
		titleKey: "nav.approvals",
		titleDefault: "Approvals",
		icon: IconClipboardCheck,
		sidebarSection: "team",
		ownsHeading: true,
		ownedHeadingSubpaths: ["/approvals"],
		cmdK: { include: true },
		isVisible: (ctx) => isManagerOrAdmin(ctx.employeeRole),
	},
	{
		id: "analytics",
		href: "/analytics",
		titleKey: "nav.analytics",
		titleDefault: "Analytics",
		icon: IconChartBar,
		sidebarSection: "team",
		ownsHeading: true,
		ownedHeadingSubpaths: [
			"/analytics/overtime-burn-down",
			"/analytics/team-performance",
			"/analytics/work-hours",
			"/analytics/vacation-trends",
		],
		cmdK: { include: true },
		isVisible: canViewAnalytics,
	},

	// ── Organization & specialist officer consoles ───────────────────────────
	{
		id: "payroll",
		href: "/payroll",
		titleKey: "nav.payroll",
		titleDefault: "Payroll",
		icon: IconCash,
		sidebarSection: "organization",
		ownsHeading: true,
		ownedHeadingSubpaths: ["/payroll/work-balances"],
		cmdK: { include: true },
		isVisible: (ctx) => ctx.navigationCapabilities.payroll,
	},
	{
		id: "travel-expenses-finance",
		href: "/travel-expenses/finance",
		titleKey: "nav.expense-finance",
		titleDefault: "Expense Finance",
		icon: IconReportMoney,
		sidebarSection: "organization",
		badgeId: "finance",
		ownsHeading: true,
		cmdK: {
			include: true,
			keywords: [
				{ key: "appSearch.expenseFinance.keywords.finance", defaultValue: "finance" },
				{ key: "appSearch.expenseFinance.keywords.reimbursement", defaultValue: "reimbursement" },
				{ key: "appSearch.expenseFinance.keywords.expenses", defaultValue: "expenses" },
			],
		},
		isVisible: (ctx) => ctx.navigationCapabilities.finance,
	},
	{
		id: "billable-hand-off",
		href: "/billable-time/hand-off",
		titleKey: "nav.billable-hand-off",
		titleDefault: "Billable Hand-off",
		icon: IconFileInvoice,
		sidebarSection: "organization",
		ownsHeading: true,
		cmdK: {
			include: true,
			keywords: [
				{ key: "appSearch.billableHandOff.keywords.billable", defaultValue: "billable" },
				{ key: "appSearch.billableHandOff.keywords.invoice", defaultValue: "invoice" },
				{ key: "appSearch.billableHandOff.keywords.handOff", defaultValue: "hand-off" },
			],
		},
		isVisible: canViewBillableHandOff,
	},
	{
		id: "personnel-files",
		href: "/personnel-files",
		titleKey: "nav.personnel-files",
		titleDefault: "Personnel Files",
		icon: IconFolders,
		sidebarSection: "organization",
		ownsHeading: true,
		ownedHeadingSubpaths: [
			"/personnel-files/document-requests",
			"/personnel-files/due-for-deletion",
			"/personnel-files/payslip-batches",
			"/personnel-files/sick-leave",
		],
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.personnelFiles),
	},
	{
		id: "equipment",
		href: "/equipment",
		titleKey: "nav.equipment",
		titleDefault: "Equipment",
		icon: IconPackage,
		sidebarSection: "organization",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.equipment),
	},
	{
		id: "team-driving-licence",
		href: TEAM_DRIVING_LICENCE_PATH,
		titleKey: "nav.team-driving-licences",
		titleDefault: "Driving licences",
		icon: IconLicense,
		sidebarSection: "organization",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => Boolean(ctx.navigationCapabilities.teamDrivingLicence),
	},
	{
		id: "compliance",
		href: "/compliance",
		titleKey: "nav.compliance",
		titleDefault: "Compliance",
		icon: IconShieldCheck,
		sidebarSection: "organization",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => ctx.navigationCapabilities.compliance,
	},
	{
		id: "works-council",
		href: "/works-council",
		titleKey: "nav.worksCouncil",
		titleDefault: "Works Council",
		icon: IconGavel,
		sidebarSection: "organization",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: (ctx) => ctx.navigationCapabilities.worksCouncil,
	},

	// ── Sub-level & non-sidebar destinations (Cmd+K & route metadata) ────────
	{
		id: "team-driving",
		href: "/team/driving",
		titleKey: "nav.missing-vehicle-logs",
		titleDefault: "Missing vehicle logs",
		icon: IconGauge,
		sidebarSection: "none",
		ownsHeading: true,
		cmdK: {
			include: true,
			keywords: [
				{ key: "appSearch.missingVehicleLogs.keywords.vehicle", defaultValue: "vehicle" },
				{ key: "appSearch.missingVehicleLogs.keywords.odometer", defaultValue: "odometer" },
				{ key: "appSearch.missingVehicleLogs.keywords.driving", defaultValue: "driving" },
				{ key: "appSearch.missingVehicleLogs.keywords.mileage", defaultValue: "mileage" },
			],
		},
		isVisible: canViewMissingVehicleLogs,
	},
	{
		id: "reports-projects",
		href: "/reports/projects",
		titleKey: "reports.projects.title",
		titleDefault: "Project Reports",
		icon: IconBriefcase,
		sidebarSection: "none",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: canViewProjectReports,
	},
	{
		id: "reports-vehicles",
		href: "/reports/vehicles",
		titleKey: "reports.vehicles.title",
		titleDefault: "Distance per Vehicle",
		icon: IconCar,
		sidebarSection: "none",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "notifications",
		href: "/notifications",
		titleKey: "notifications.title",
		titleDefault: "Notifications",
		icon: IconBell,
		sidebarSection: "none",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "billing-suspended",
		href: "/billing/suspended",
		titleKey: "settings.billing.title",
		titleDefault: "Billing & Subscription",
		icon: IconCreditCard,
		sidebarSection: "none",
		ownsHeading: true,
		cmdK: { include: false },
		isVisible: () => false,
	},

	// ── Settings & help (utility-only footer) ────────────────────────────────
	{
		id: "settings",
		href: "/settings",
		titleKey: "nav.settings",
		titleDefault: "Settings",
		icon: IconSettings,
		sidebarSection: "secondary",
		ownsHeading: true,
		cmdK: { include: true },
		isVisible: () => true,
	},
	{
		id: "get-help",
		href: "https://docs.z8-time.app/docs",
		titleKey: "nav.get-help",
		titleDefault: "Get Help",
		icon: IconHelp,
		sidebarSection: "secondary",
		external: true,
		ownsHeading: false,
		includeInRouteMetadata: false,
		cmdK: { include: false },
		isVisible: () => true,
	},
	{
		id: "feedback",
		href: "https://github.com/Umami-Creative-GmbH/z8/issues",
		titleKey: "nav.feedback",
		titleDefault: "Feedback",
		icon: IconMessageCircle,
		sidebarSection: "secondary",
		external: true,
		ownsHeading: false,
		includeInRouteMetadata: false,
		cmdK: { include: false },
		isVisible: () => true,
	},
	{
		id: "platform-admin",
		href: "/platform-admin",
		titleKey: "nav.platform-admin",
		titleDefault: "Platform Admin",
		icon: IconServerCog,
		sidebarSection: "secondary",
		ownsHeading: false,
		cmdK: { include: false },
		isVisible: (ctx) => ctx.navigationCapabilities.platformAdmin,
	},
] as const;

const MANIFEST_BY_ID = new Map<string, NavigationManifestEntry>(
	APP_NAVIGATION_MANIFEST.map((entry) => [entry.id, entry]),
);

const MANIFEST_ICON_BY_HREF = new Map<string, NavigationIcon>();
for (const entry of APP_NAVIGATION_MANIFEST) {
	if (entry.external) continue;
	if (!MANIFEST_ICON_BY_HREF.has(entry.href)) {
		MANIFEST_ICON_BY_HREF.set(entry.href, entry.icon);
	}
	if (entry.routeMatchHref && !MANIFEST_ICON_BY_HREF.has(entry.routeMatchHref)) {
		MANIFEST_ICON_BY_HREF.set(entry.routeMatchHref, entry.icon);
	}
}

export function getNavigationManifestEntryById(id: string): NavigationManifestEntry | undefined {
	return MANIFEST_BY_ID.get(id);
}

export function getSidebarManifestEntries(
	section: Exclude<SidebarSection, "none">,
	ctx: NavigationAccessContext,
): NavigationManifestEntry[] {
	return APP_NAVIGATION_MANIFEST.filter(
		(entry) => entry.sidebarSection === section && entry.isVisible(ctx),
	);
}

export function getCmdKManifestEntries(ctx: NavigationAccessContext): NavigationManifestEntry[] {
	return APP_NAVIGATION_MANIFEST.filter((entry) => entry.cmdK.include && entry.isVisible(ctx));
}

export function getNavigationIconForHref(
	href: string,
	resultId?: string,
): NavigationIcon | undefined {
	if (resultId) {
		const manifestId = resultId.startsWith("page:") ? resultId.slice("page:".length) : resultId;
		const entry = MANIFEST_BY_ID.get(manifestId);
		if (entry && (entry.href === href || entry.routeMatchHref === href)) {
			return entry.icon;
		}
	}
	return MANIFEST_ICON_BY_HREF.get(href);
}

export function getManifestRouteMetadata() {
	return APP_NAVIGATION_MANIFEST.filter(
		(entry) => entry.includeInRouteMetadata ?? !entry.external,
	).map((entry) => ({
		id: entry.id,
		href: entry.routeMatchHref ?? entry.href,
		titleKey: entry.titleKey,
		titleDefault: entry.titleDefault,
	}));
}

export function getManifestOwnedHeadingPaths(): ReadonlySet<string> {
	const paths = new Set<string>();
	for (const entry of APP_NAVIGATION_MANIFEST) {
		if (entry.external || !entry.ownsHeading) continue;
		paths.add(entry.href);
		for (const subpath of entry.ownedHeadingSubpaths ?? []) {
			paths.add(subpath);
		}
	}
	return paths;
}
