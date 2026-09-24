"use server";

import type { ServerActionResult } from "@/lib/effect/result";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { getManualEntryTargetContextForEmployee } from "./manual-entry-target";
import { logger } from "./shared";
import {
	MANUAL_ENTRY_TARGET_NOT_AUTHORIZED,
	type ManualEntryTargetContext,
} from "./types";

/**
 * Advisory form context for creating a manual entry: the target's effective
 * zone plus the projects and categories the target may book. Omit
 * `targetEmployeeId` for the signed-in employee.
 */
export async function getManualEntryTargetContext(input: {
	targetEmployeeId?: string | null;
}): Promise<ServerActionResult<ManualEntryTargetContext>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const result = await getManualEntryTargetContextForEmployee({
			currentEmployee,
			requestedEmployeeId: input.targetEmployeeId,
		});
		return result.success
			? result
			: { ...result, code: MANUAL_ENTRY_TARGET_NOT_AUTHORIZED };
	} catch (error) {
		logger.error({ error }, "Failed to load manual entry target context");
		return { success: false, error: "Failed to load entry options" };
	}
}
