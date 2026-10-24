import "server-only";

import type { Instant } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { checkLifecycleTarget } from "../lifecycle-target";
import { planDeactivationConsequences, readCurrentEmploymentPeriodId } from "./plan";
import type { DeactivationPlan, DeactivationReader } from "./types";

export type DeactivationPreviewInput = {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	/** Report employee id → the replacement manager being considered. */
	replacementManagers: Readonly<Record<string, string>>;
	now: Instant;
};

export type DeactivationPreviewResult =
	| { kind: "ok"; plan: DeactivationPlan }
	| { kind: "not_found" }
	| { kind: "forbidden"; code: "actor_not_authorized" | "self_target" | "admin_targeting_owner" }
	| {
			kind: "invalid";
			code: "already_inactive" | "target_membership_missing" | "final_accessible_owner";
	  };

/**
 * The advisory preview of Deactivate (#1440): the same authorization and
 * owner rules as the action, then the plan the deactivation would apply now,
 * with the replacement picks being considered. Reads only and takes no locks;
 * the action recomputes the plan inside its transaction and refuses when a
 * required replacement is missing or no longer eligible.
 */
export async function previewEmployeeDeactivation(
	database: DeactivationReader,
	input: DeactivationPreviewInput,
): Promise<DeactivationPreviewResult> {
	const check = await checkLifecycleTarget(database, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		employeeId: input.employeeId,
		isActive: false,
	});
	switch (check.type) {
		case "change":
			break;
		case "not_found":
			return { kind: "not_found" };
		case "actor_membership_missing":
			return { kind: "forbidden", code: "actor_not_authorized" };
		case "self_target":
		case "admin_targeting_owner":
			return { kind: "forbidden", code: check.type };
		case "unchanged":
			return { kind: "invalid", code: "already_inactive" };
		case "target_membership_missing":
		case "final_accessible_owner":
			return { kind: "invalid", code: check.type };
		case "rehire_required":
			// Only a reactivation asks for a rehire.
			return { kind: "invalid", code: "already_inactive" };
	}

	const organizationTimeZone = await loadOrganizationTimezone(database, input.organizationId);
	const employmentPeriodId = await readCurrentEmploymentPeriodId(database, input);
	const plan = await planDeactivationConsequences(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		at: input.now,
		organizationTimeZone,
		employmentPeriodId,
		replacementManagers: input.replacementManagers,
		replaceManagers: true,
	});
	return { kind: "ok", plan };
}
