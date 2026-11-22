import type { FeatureFlagState } from "@/components/settings/settings-config";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { SettingsCapabilities } from "@/lib/settings/capabilities";

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
	settingsAccess: SettingsAccess | null;
	billingEnabled: boolean;
	showComplianceNav: boolean;
	showPayrollNav?: boolean;
	featureFlags?: FeatureFlagState;
	/** Server-computed non-tier visibility capabilities (ADR 0003). */
	settingsCapabilities?: Partial<SettingsCapabilities>;
	/** The driving licence visibility reader shows My driving licence (#1937). */
	showMyDrivingLicenceNav?: boolean;
	/** The driving licence visibility reader shows Team & organization → Driving licences (#1937). */
	showTeamDrivingLicenceNav?: boolean;
}

export interface LiveAppSearchResults {
	employees: AppSearchResult[];
	teams: AppSearchResult[];
}
