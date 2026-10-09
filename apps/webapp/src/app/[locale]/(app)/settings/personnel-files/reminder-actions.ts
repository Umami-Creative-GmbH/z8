"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requirePersonnelFileAdministrator } from "@/lib/personnel-file/administrator";
import { validateExpiryReminderLeadDays } from "@/lib/personnel-file/expiry";
import { saveExpiryReminderLeadDays } from "@/lib/personnel-file/expiry-store";

/**
 * Expiry reminder settings (#869): the lead time in days before an expiry
 * date at which officers and employees are reminded. Changed by owners and
 * admins on the Reminders tab of Settings → Personnel files.
 */
export async function savePersonnelFileExpiryLeadDaysAction(input: {
	leadDays: unknown;
}): Promise<ServerActionResult<{ leadDays: number }>> {
	try {
		const access = await requirePersonnelFileAdministrator();
		if ("error" in access) {
			return { success: false, error: "Only owners and admins can change the reminder lead time" };
		}
		const validation = validateExpiryReminderLeadDays(input?.leadDays);
		if (!validation.ok) return { success: false, error: validation.message };
		await saveExpiryReminderLeadDays(db, {
			organizationId: access.organizationId,
			leadDays: validation.value,
			actorUserId: access.userId,
		});
		revalidatePath("/settings/personnel-files");
		revalidatePath("/personnel-files");
		return { success: true, data: { leadDays: validation.value } };
	} catch (error) {
		logger.error({ error }, "Failed to save the personnel file reminder lead time");
		return { success: false, error: "Failed to save the reminder lead time" };
	}
}
