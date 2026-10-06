"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { travelExpenseSettings } from "@/db/schema";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadReceiptExceptionsAllowed } from "@/lib/travel-expenses/receipt-exception-read";

/**
 * Whether employees may submit an explained missing-receipt exception (#604).
 * Only expense administrators (organization settings managers) change it;
 * submitted reports keep the exceptions they were submitted with.
 */

export interface ReceiptExceptionSettings {
	missingReceiptExceptionsAllowed: boolean;
}

async function requireOrgAdmin(): Promise<
	{ error: string } | { organizationId: string; userId: string }
> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext) return { error: "Unauthorized: Admin access required" };
	if (!organizationId) return { error: "No organization selected" };
	if (!(await canManageCurrentOrganizationSettings())) {
		return { error: "Unauthorized: Admin access required" };
	}
	return { organizationId, userId: authContext.user.id };
}

export async function getReceiptExceptionSettings(): Promise<
	ServerActionResult<ReceiptExceptionSettings>
> {
	try {
		const access = await requireOrgAdmin();
		if ("error" in access) return { success: false, error: access.error };
		return {
			success: true,
			data: {
				missingReceiptExceptionsAllowed: await loadReceiptExceptionsAllowed(
					db,
					access.organizationId,
				),
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the missing-receipt exception setting");
		return { success: false, error: "Failed to load the missing-receipt setting" };
	}
}

const saveSchema = z.object({ missingReceiptExceptionsAllowed: z.boolean() });

export async function saveReceiptExceptionSettings(
	input: ReceiptExceptionSettings,
): Promise<ServerActionResult<ReceiptExceptionSettings>> {
	try {
		const access = await requireOrgAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const parsed = saveSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid setting" };
		const allowed = parsed.data.missingReceiptExceptionsAllowed;
		const now = new Date();
		await db
			.insert(travelExpenseSettings)
			.values({
				organizationId: access.organizationId,
				missingReceiptExceptionsAllowed: allowed,
				updatedAt: now,
				updatedBy: access.userId,
			})
			// Only this setting; the other columns belong to other settings.
			.onConflictDoUpdate({
				target: travelExpenseSettings.organizationId,
				set: { missingReceiptExceptionsAllowed: allowed, updatedAt: now, updatedBy: access.userId },
			});
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { missingReceiptExceptionsAllowed: allowed } };
	} catch (error) {
		logger.error({ error }, "Failed to save the missing-receipt exception setting");
		return { success: false, error: "Failed to save the missing-receipt setting" };
	}
}
