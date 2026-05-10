import { getResolvedSettingsVisibility } from "@/components/settings/settings-config";
import type { AppSearchResult, StaticAppSearchInput } from "./types";

const PERSONAL_PAGE_DESTINATIONS = [
	{
		id: "dashboard",
		titleKey: "nav.dashboard",
		titleDefault: "Dashboard",
		href: "/",
	},
	{
		id: "time-tracking",
		titleKey: "nav.time-tracking",
		titleDefault: "Time Tracking",
		href: "/time-tracking",
	},
	{
		id: "my-requests",
		titleKey: "nav.my-requests",
		titleDefault: "My Requests",
		href: "/my-requests",
	},
	{
		id: "calendar",
		titleKey: "nav.calendar",
		titleDefault: "Calendar",
		href: "/calendar",
	},
	{
		id: "org-explorer",
		titleKey: "nav.org-explorer",
		titleDefault: "Org Explorer",
		href: "/organization",
	},
	{
		id: "absences",
		titleKey: "nav.absences",
		titleDefault: "Absences",
		href: "/absences",
	},
	{
		id: "travel-expenses",
		titleKey: "nav.travel-expenses",
		titleDefault: "Travel Expenses",
		href: "/travel-expenses",
	},
	{
		id: "reports",
		titleKey: "nav.reports",
		titleDefault: "Reports",
		href: "/reports",
	},
] as const;

const TEAM_PAGE_DESTINATIONS = [
	{
		id: "team",
		titleKey: "nav.team",
		titleDefault: "Team",
		href: "/team",
	},
	{
		id: "approvals",
		titleKey: "nav.approvals",
		titleDefault: "Approvals",
		href: "/approvals/inbox",
	},
] as const;

const SETTINGS_PAGE_DESTINATION = {
	id: "settings",
	titleKey: "nav.settings",
	titleDefault: "Settings",
	href: "/settings",
} as const;

function isManagerOrAdmin(employeeRole: StaticAppSearchInput["employeeRole"]): boolean {
	return employeeRole === "admin" || employeeRole === "manager";
}

function dedupeResults(results: AppSearchResult[]): AppSearchResult[] {
	const seen = new Set<string>();

	return results.filter((result) => {
		const key = `${result.type}:${result.href}`;
		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

export function buildStaticAppSearchResults({
	t,
	employeeRole,
	settingsAccessTier,
	billingEnabled,
	showComplianceNav,
	featureFlags,
}: StaticAppSearchInput): AppSearchResult[] {
	const pageResults: AppSearchResult[] = PERSONAL_PAGE_DESTINATIONS.map((destination) => ({
		type: "page",
		id: `page:${destination.id}`,
		title: t(destination.titleKey, destination.titleDefault),
		href: destination.href,
	}));

	if (isManagerOrAdmin(employeeRole)) {
		pageResults.push(
			...TEAM_PAGE_DESTINATIONS.map((destination) => ({
				type: "page" as const,
				id: `page:${destination.id}`,
				title: t(destination.titleKey, destination.titleDefault),
				href: destination.href,
			})),
		);

		if (featureFlags?.shiftsEnabled) {
			pageResults.push({
				type: "page",
				id: "page:scheduling",
				title: t("nav.scheduling", "Scheduling"),
				href: "/scheduling",
			});
		}
	}

	if (showComplianceNav) {
		pageResults.push({
			type: "page",
			id: "page:compliance",
			title: t("nav.compliance", "Compliance"),
			href: "/compliance",
		});
	}

	pageResults.push({
		type: "page",
		id: `page:${SETTINGS_PAGE_DESTINATION.id}`,
		title: t(SETTINGS_PAGE_DESTINATION.titleKey, SETTINGS_PAGE_DESTINATION.titleDefault),
		href: SETTINGS_PAGE_DESTINATION.href,
	});

	const { visibleSettings } = getResolvedSettingsVisibility({
		accessTier: settingsAccessTier,
		billingEnabled,
		featureFlags,
	});

	const settingsResults: AppSearchResult[] = visibleSettings.map((setting) => ({
		type: "setting",
		id: `setting:${setting.id}`,
		title: t(setting.titleKey, setting.titleDefault),
		subtitle: t(setting.descriptionKey, setting.descriptionDefault),
		href: setting.href,
	}));

	return dedupeResults([...pageResults, ...settingsResults]);
}
