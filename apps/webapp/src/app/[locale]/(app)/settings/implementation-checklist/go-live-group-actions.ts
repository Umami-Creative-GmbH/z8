"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	chooseGoLiveGroupTeams,
	createGoLiveExclusion,
	type GoLiveGroupCommandResult,
	type GoLiveGroupRefusal,
	liftGoLiveExclusion,
} from "@/lib/implementation-checklist/go-live/group-settings";
import { createLogger } from "@/lib/logger";

const logger = createLogger("GoLiveGroupActions");

const IMPLEMENTATION_CHECKLIST_PATH = "/settings/implementation-checklist";

export type GoLiveGroupActionResult =
	| { success: true }
	| { success: false; error: string; refusal?: GoLiveGroupRefusal };

const REFUSAL_MESSAGES: Record<GoLiveGroupRefusal, string> = {
	team_not_found: "One of the chosen teams no longer exists.",
	employee_not_found: "This employee is not on the current roster.",
	reason_required: "Give a reason for the exclusion.",
	reason_too_long: "The reason is too long.",
	already_excluded: "This employee is already excluded.",
	exclusion_not_found: "This exclusion has already ended.",
};

/**
 * Runs one go-live group command for the caller's active organization, as the
 * caller. Org admins only: anyone else is redirected before anything runs.
 */
async function runGoLiveGroupCommand(
	command: (scope: {
		organizationId: string;
		actorUserId: string;
	}) => Promise<GoLiveGroupCommandResult>,
): Promise<GoLiveGroupActionResult> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	let result: GoLiveGroupCommandResult;
	try {
		result = await command({ organizationId, actorUserId: authContext.user.id });
	} catch (error) {
		logger.error({ organizationId, error }, "Go-live group command failed");
		return { success: false, error: "Failed to update the go-live group." };
	}
	if (!result.ok) return refused(result.refusal);
	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);
	return { success: true };
}

function refused(refusal: GoLiveGroupRefusal): GoLiveGroupActionResult {
	return { success: false, refusal, error: REFUSAL_MESSAGES[refusal] };
}

/** Narrows the go-live group to the chosen teams, or to the whole roster with none. */
export async function chooseGoLiveGroupTeamsAction(
	teamIds: string[],
): Promise<GoLiveGroupActionResult> {
	return runGoLiveGroupCommand(async (scope) => {
		if (!Array.isArray(teamIds) || !teamIds.every((id) => typeof id === "string")) {
			return { ok: false, refusal: "team_not_found" };
		}
		return chooseGoLiveGroupTeams(db, { ...scope, teamIds });
	});
}

/** Leaves one employee out of the go-live group, for a required reason. */
export async function createGoLiveExclusionAction(input: {
	employeeId: string;
	reason: string;
}): Promise<GoLiveGroupActionResult> {
	return runGoLiveGroupCommand(async (scope) => {
		if (typeof input?.employeeId !== "string") return { ok: false, refusal: "employee_not_found" };
		if (typeof input.reason !== "string") return { ok: false, refusal: "reason_required" };
		return createGoLiveExclusion(db, {
			...scope,
			employeeId: input.employeeId,
			reason: input.reason,
		});
	});
}

/** Lifts a go-live exclusion, bringing the employee back into the checks. */
export async function liftGoLiveExclusionAction(
	exclusionId: string,
): Promise<GoLiveGroupActionResult> {
	return runGoLiveGroupCommand(async (scope) => {
		if (typeof exclusionId !== "string") return { ok: false, refusal: "exclusion_not_found" };
		return liftGoLiveExclusion(db, { ...scope, exclusionId });
	});
}
