"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { saveEmployeeSickNoteUpload } from "@/lib/absences/absence-settings";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";

/**
 * "Employees can attach sick notes" (#982): an absence setting owners and
 * admins change. It can be turned on only while personnel files are on.
 */
export async function saveEmployeeSickNoteUploadAction(input: {
	enabled: unknown;
}): Promise<ServerActionResult<{ employeeSickNoteUpload: boolean }>> {
	try {
		const context = await getCurrentSettingsRouteContext();
		const organizationId = context?.authContext.session.activeOrganizationId;
		if (!context || context.accessTier !== "orgAdmin" || !organizationId) {
			return { success: false, error: "Only owners and admins can change absence settings" };
		}
		if (typeof input?.enabled !== "boolean") {
			return { success: false, error: "Invalid setting" };
		}
		const result = await saveEmployeeSickNoteUpload(db, {
			organizationId,
			enabled: input.enabled,
			actorUserId: context.authContext.user.id,
		});
		if (result.kind === "personnel_files_disabled") {
			return {
				success: false,
				error: "Turn on personnel files first: sick notes are stored there.",
				code: "personnel_files_disabled",
			};
		}
		revalidatePath("/settings/vacation");
		revalidatePath("/absences");
		return { success: true, data: { employeeSickNoteUpload: result.employeeSickNoteUpload } };
	} catch (error) {
		logger.error({ error }, "Failed to save the employee sick note setting");
		return { success: false, error: "Failed to save the setting" };
	}
}
