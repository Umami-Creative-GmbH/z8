import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type AppSearchResultType = "page" | "setting" | "employee" | "team";

export interface AppSearchResult {
	type: AppSearchResultType;
	id: string;
	title: string;
	subtitle?: string;
	href: string;
}

export type AppSearchTranslate = (key: string, defaultValue: string) => string;

export type AppSearchEmployeeRole = "admin" | "manager" | "employee" | null;

export interface StaticAppSearchInput {
	t: AppSearchTranslate;
	employeeRole: AppSearchEmployeeRole;
	settingsAccessTier: SettingsAccessTier;
	billingEnabled: boolean;
	showComplianceNav: boolean;
	featureFlags?: FeatureFlagState;
}

export interface LiveAppSearchResults {
	employees: AppSearchResult[];
	teams: AppSearchResult[];
}
