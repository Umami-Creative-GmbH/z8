import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type AppSearchResultType = "page" | "setting" | "employee" | "team" | "action";

export interface AppSearchResult {
	type: AppSearchResultType;
	id: string;
	title: string;
	subtitle?: string;
	keywords?: string[];
	href: string;
	image?: string | null;
	avatarSeed?: string;
	gender?: "male" | "female" | "other" | null;
}

export type AppSearchTranslate = (key: string, defaultValue: string) => string;

export type AppSearchEmployeeRole = "admin" | "manager" | "employee" | null;

export interface StaticAppSearchInput {
	t: AppSearchTranslate;
	employeeRole: AppSearchEmployeeRole;
	settingsAccessTier: SettingsAccessTier;
	billingEnabled: boolean;
	showComplianceNav: boolean;
	showPayrollNav?: boolean;
	featureFlags?: FeatureFlagState;
	/** The user manages a project below the manager tier (#928). */
	managesProject?: boolean;
	/** The driving licence visibility reader shows the personal Driving licence item (#1420). */
	showDrivingLicenceNav?: boolean;
	/** The driving licence visibility reader offers its settings (#1420). */
	drivingLicenceSettingsVisible?: boolean;
}

export interface LiveAppSearchResults {
	employees: AppSearchResult[];
	teams: AppSearchResult[];
}
