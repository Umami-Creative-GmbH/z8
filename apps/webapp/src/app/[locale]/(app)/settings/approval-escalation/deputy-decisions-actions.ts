"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { saveDeputyDecisionsEnabled } from "@/lib/approvals/approval-settings";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";

const APPROVAL_ESCALATION_PATH = "/settings/approval-escalation";

/**
 * "Deputies can decide approvals" (#1015, Approvals ADR 0002): an approval
 * setting that users who can manage approvals change, like the escalation
 * policy on the same page. Changes are audit-logged.
 */
export async function saveDeputyDecisionsEnabledAction(input: {
	enabled: unknown;
}): Promise<ServerActionResult<{ deputyDecisionsEnabled: boolean }>> {
	try {
		const authContext = await getAuthContext();
		const organizationId = authContext?.session.activeOrganizationId;
		const ability = authContext && organizationId ? await getAbility() : null;
		if (!authContext || !organizationId || !ability || ability.cannot("manage", "Approval")) {
			return { success: false, error: "You do not have permission to manage approval settings." };
		}
		if (typeof input?.enabled !== "boolean") {
			return { success: false, error: "Invalid setting" };
		}
		const result = await saveDeputyDecisionsEnabled(db, {
			organizationId,
			enabled: input.enabled,
			actorUserId: authContext.user.id,
		});
		revalidatePath(APPROVAL_ESCALATION_PATH);
		return { success: true, data: { deputyDecisionsEnabled: result.deputyDecisionsEnabled } };
	} catch (error) {
		logger.error({ error }, "Failed to save the deputy decisions setting");
		return { success: false, error: "Failed to save the setting" };
	}
}
