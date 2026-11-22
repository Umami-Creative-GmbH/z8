import "server-only";

import { cache } from "react";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { hasTaskManagedProject, managesProjectTasks } from "./project-task-permission";

/**
 * Whether the settings navigation offers the caller the tasks-only Projects
 * view (#928): a member-level user who manages a project of the active
 * organization. Scoped managers and org admins already see Projects by their access.
 */
export const managesProjectBelowScopedManager = cache(
	async (
		settingsAccess: SettingsAccess | null,
		userId: string | null,
		organizationId: string | null,
	): Promise<boolean> => {
		if (!settingsAccess || meetsSettingsAccess(settingsAccess, "scopedManager")) return false;
		if (!userId || !organizationId) return false;
		return managesProjectTasks({ userId, organizationId });
	},
);

/** Internal render-only counterpart; destination guards still resolve fresh identity. */
export async function managesProjectBelowScopedManagerForIdentity(
	settingsAccess: SettingsAccess | null,
	identity: AuthorizedOrganizationIdentity,
) {
	if (!settingsAccess || meetsSettingsAccess(settingsAccess, "scopedManager") || !identity.employee)
		return false;
	return hasTaskManagedProject({
		userId: identity.userId,
		organizationId: identity.organizationId,
		isOrgAdmin: false,
	});
}
