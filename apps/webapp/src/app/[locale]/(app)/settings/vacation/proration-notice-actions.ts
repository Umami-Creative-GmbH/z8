"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { dismissProrationNotice } from "@/lib/absences/proration-notice-store";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";

/**
 * Dismisses the one-time list of employees whose 2026 allowance is now prorated (#1112), for
 * every owner and admin of the organization, for good. Managers and employees are refused.
 */
export async function dismissProrationNoticeAction(): Promise<ServerActionResult<void>> {
	try {
		const context = await getCurrentSettingsRouteContext();
		const organizationId = context?.authContext.session.activeOrganizationId;
		if (!context || context.accessTier !== "orgAdmin" || !organizationId) {
			return { success: false, error: "Only owners and admins can dismiss this notice" };
		}
		await dismissProrationNotice(db, {
			organizationId,
			actorUserId: context.authContext.user.id,
		});
		revalidatePath("/settings/vacation");
		revalidatePath("/settings/vacation/employees");
		return { success: true, data: undefined };
	} catch (error) {
		logger.error({ error }, "Failed to dismiss the proration notice");
		return { success: false, error: "Failed to dismiss the notice" };
	}
}
