import "server-only";

import { cache } from "react";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import {
	hasSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";
import {
	hasTaskManagedProject,
	managesProjectTasks,
} from "./project-task-permission";

/**
 * Whether the settings navigation offers the caller the tasks-only Projects
 * view (#928): a member-tier user who manages a project of the active
 * organization. Managers and org admins already see Projects by their tier.
 */
export const managesProjectBelowManagerTier = cache(
	async (
		accessTier: SettingsAccessTier | null,
		userId: string | null,
		organizationId: string | null,
	): Promise<boolean> => {
		if (!accessTier || hasSettingsAccessTier(accessTier, "manager"))
			return false;
		if (!userId || !organizationId) return false;
		return managesProjectTasks({ userId, organizationId });
	},
);

/** Internal render-only counterpart; destination guards still resolve fresh identity. */
export async function managesProjectBelowManagerTierForIdentity(
	accessTier: SettingsAccessTier | null,
	identity: AuthorizedOrganizationIdentity,
) {
	if (
		!accessTier ||
		hasSettingsAccessTier(accessTier, "manager") ||
		!identity.employee
	)
		return false;
	return hasTaskManagedProject({
		userId: identity.userId,
		organizationId: identity.organizationId,
		isOrgAdmin: false,
	});
}
