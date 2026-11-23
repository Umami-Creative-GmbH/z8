import { getResolvedSettingsVisibility } from "@/components/settings/settings-config";
import {
	getCmdKManifestEntries,
	type NavigationAccessContext,
	type NavigationCapabilities,
	type NavigationSearchKeyword,
} from "@/lib/navigation/navigation-manifest";
import type { AppSearchResult, StaticAppSearchInput } from "./types";

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

function translateKeywords(
	keywords: readonly NavigationSearchKeyword[],
	t: StaticAppSearchInput["t"],
): string[] {
	return keywords.map((keyword) => t(keyword.key, keyword.defaultValue));
}

function toNavigationAccessContext(input: StaticAppSearchInput): NavigationAccessContext {
	const capabilities: NavigationCapabilities = {
		scheduling:
			input.navigationCapabilities?.scheduling ?? Boolean(input.featureFlags?.shiftsEnabled),
		compliance: input.navigationCapabilities?.compliance ?? input.showComplianceNav,
		payroll: input.navigationCapabilities?.payroll ?? Boolean(input.showPayrollNav),
		finance: input.navigationCapabilities?.finance ?? false,
		billableHandOff: input.navigationCapabilities?.billableHandOff,
		worksCouncil: input.navigationCapabilities?.worksCouncil ?? false,
		myDocuments: input.navigationCapabilities?.myDocuments,
		myEquipment: input.navigationCapabilities?.myEquipment,
		equipment: input.navigationCapabilities?.equipment,
		personnelFiles: input.navigationCapabilities?.personnelFiles,
		periodSubmissions: input.navigationCapabilities?.periodSubmissions,
		teamPresence: input.navigationCapabilities?.teamPresence,
		myDrivingLicence:
			input.navigationCapabilities?.myDrivingLicence ?? input.showMyDrivingLicenceNav,
		teamDrivingLicence:
			input.navigationCapabilities?.teamDrivingLicence ?? input.showTeamDrivingLicenceNav,
		missingVehicleLogs: input.navigationCapabilities?.missingVehicleLogs,
		analytics: input.navigationCapabilities?.analytics,
		projectReports: input.navigationCapabilities?.projectReports,
		approvalInbox: input.navigationCapabilities?.approvalInbox,
		platformAdmin: input.navigationCapabilities?.platformAdmin ?? false,
	};

	return {
		employeeRole: input.employeeRole,
		settingsAccess: input.settingsAccess,
		navigationCapabilities: capabilities,
		featureFlags: input.featureFlags,
		settingsCapabilities: input.settingsCapabilities,
	};
}

export function buildStaticAppSearchResults(input: StaticAppSearchInput): AppSearchResult[] {
	const { t, settingsAccess, billingEnabled, featureFlags, settingsCapabilities } = input;

	const pageResults: AppSearchResult[] = getCmdKManifestEntries(
		toNavigationAccessContext(input),
	).map((entry) => ({
		type: "page",
		id: `page:${entry.id}`,
		title: t(entry.titleKey, entry.titleDefault),
		href: entry.href,
		...(entry.cmdK.descriptionKey && entry.cmdK.descriptionDefault
			? {
					subtitle: t(entry.cmdK.descriptionKey, entry.cmdK.descriptionDefault),
				}
			: {}),
		...(entry.cmdK.keywords ? { keywords: translateKeywords(entry.cmdK.keywords, t) } : {}),
	}));

	const { visibleSettings } = getResolvedSettingsVisibility({
		settingsAccess,
		billingEnabled,
		featureFlags,
		settingsCapabilities,
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
