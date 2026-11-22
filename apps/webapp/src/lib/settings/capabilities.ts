/**
 * Non-tier visibility exceptions for Settings navigation, the Settings hub,
 * and app search (ADR 0003). Computed once on the server per request and
 * passed as a typed object; client components never evaluate CASL abilities.
 */
export interface SettingsCapabilities {
	/** Custom-role or org-level grant to close or reopen months (Closed months). */
	canAccessClosedMonths: boolean;
	/** Custom-role or workforce-admin grant to manage approval escalations (Approval). */
	canManageApprovalEscalation: boolean;
	/** Caller manages at least one project below `scopedManager` (Projects tasks-only view). */
	canManageProjects: boolean;
	/** Driving licence visibility reader offers Driving licence control settings. */
	canManageDrivingLicence: boolean;
	/** Organization has at least one active (unrevoked, unexpired) report share link. */
	hasActiveReportShareLinks: boolean;
}

export type SettingsCapabilityKey = keyof SettingsCapabilities;

export const DEFAULT_SETTINGS_CAPABILITIES: SettingsCapabilities = {
	canAccessClosedMonths: false,
	canManageApprovalEscalation: false,
	canManageProjects: false,
	canManageDrivingLicence: false,
	hasActiveReportShareLinks: false,
};

export function resolveSettingsCapabilitiesInput(
	capabilities?: Partial<SettingsCapabilities>,
): SettingsCapabilities {
	if (!capabilities) return DEFAULT_SETTINGS_CAPABILITIES;
	return {
		...DEFAULT_SETTINGS_CAPABILITIES,
		...capabilities,
	};
}
