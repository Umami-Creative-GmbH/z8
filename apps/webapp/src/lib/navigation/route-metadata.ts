import { SETTINGS_ENTRIES } from "@/components/settings/settings-config";
import { ALL_LANGUAGES } from "@/tolgee/shared";

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
	{
		id: "reports-projects",
		href: "/reports/projects",
		titleKey: "reports.projects.title",
		titleDefault: "Project Reports",
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
	...SETTINGS_ENTRIES.map((entry) => ({
		id: `settings-${entry.id}`,
		href: entry.href,
		titleKey: entry.titleKey,
		titleDefault: entry.titleDefault,
	})),
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
