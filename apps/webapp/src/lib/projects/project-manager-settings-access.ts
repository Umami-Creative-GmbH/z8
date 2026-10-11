import "server-only";

import { cache } from "react";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { managesProjectTasks } from "./project-task-permission";

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
		if (accessTier !== "member" || !userId || !organizationId) return false;
		return managesProjectTasks({ userId, organizationId });
	},
);
