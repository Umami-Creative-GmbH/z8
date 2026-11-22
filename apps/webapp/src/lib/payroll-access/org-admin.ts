import "server-only";

import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";

/**
 * Whether the current signed-in caller has organization administrator authority
 * (`orgAdmin` or `owner`) for `organizationId` (#1957).
 */
export async function isOrgAdminForOrganization(organizationId: string): Promise<boolean> {
	const settingsCaller = await getCurrentSettingsAccess();
	return Boolean(
		settingsCaller?.settingsAccess &&
			settingsCaller.organizationId === organizationId &&
			meetsSettingsAccess(settingsCaller.settingsAccess, "orgAdmin"),
	);
}
