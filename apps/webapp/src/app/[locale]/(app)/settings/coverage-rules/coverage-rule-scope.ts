import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { coverageRule, subareaEmployee } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";

/**
 * The subareas whose coverage rules the actor manages: every subarea (null) for an
 * org admin; for a scoped manager whose employee role is manager, the subareas they
 * are assigned to. Anyone else, or a manager without an assigned subarea, has no
 * coverage rule settings and is refused.
 */
export function coverageRuleSubareaScope(actor: OrganizationActor) {
	return Effect.gen(function* () {
		if (meetsSettingsAccess(actor.settingsAccess, "orgAdmin")) {
			return null as ReadonlySet<string> | null;
		}
		const employeeId = actor.employee?.role === "manager" ? actor.employee.id : null;
		const dbService = yield* DatabaseService;
		const assignments = employeeId
			? yield* dbService.query("coverageRules.subareaScope", () =>
					dbService.db.query.subareaEmployee.findMany({
						where: eq(subareaEmployee.employeeId, employeeId),
						columns: { subareaId: true },
					}),
				)
			: [];
		if (assignments.length === 0) {
			return yield* Effect.fail(outOfScope(actor));
		}
		return new Set(
			assignments.map((assignment) => assignment.subareaId),
		) as ReadonlySet<string> | null;
	});
}

/** True when `subareaId` is within `scope` (null is every subarea). */
export function inSubareaScope(
	scope: ReadonlySet<string> | null,
	subareaId: string | null | undefined,
) {
	return scope === null || Boolean(subareaId && scope.has(subareaId));
}

/** Fails with the refusal unless `subareaId` is within `scope`. */
export function withinSubareaScope(
	actor: OrganizationActor,
	scope: ReadonlySet<string> | null,
	subareaId: string | null | undefined,
) {
	return inSubareaScope(scope, subareaId) ? Effect.void : Effect.fail(outOfScope(actor));
}

/** The rule `ruleId` of `organizationId`; another organization's rule is not found. */
export function loadCoverageRuleTarget(organizationId: string, ruleId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const rule = yield* dbService.query("coverageRules.target", () =>
			dbService.db.query.coverageRule.findFirst({
				where: and(eq(coverageRule.id, ruleId), eq(coverageRule.organizationId, organizationId)),
				columns: { id: true, subareaId: true },
			}),
		);
		if (!rule) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Coverage rule not found",
					entityType: "coverage_rule",
					entityId: ruleId,
				}),
			);
		}
		return rule;
	});
}

function outOfScope(actor: OrganizationActor) {
	return new AuthorizationError({
		message: "Unauthorized",
		userId: actor.userId,
		resource: "coverage_rule",
		action: "manage",
	});
}
