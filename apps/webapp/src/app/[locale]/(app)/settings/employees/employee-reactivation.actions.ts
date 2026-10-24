"use server";

import { Effect } from "effect";
import { z } from "zod";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	type LifecycleHistory,
	loadLifecycleHistory,
} from "@/lib/employee-lifecycle/lifecycle-history";
import type { ReactivationChecklist } from "@/lib/employee-lifecycle/reactivation-checklist";
import {
	dismissReactivationChecklist,
	loadReactivationChecklist,
} from "@/lib/employee-lifecycle/reactivation-checklist-store";
import { createLogger } from "@/lib/logger";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

/**
 * Reactivation (#1441): the re-grant checklist (org admins) and the
 * deactivations and reactivations in the employment history (whoever may read
 * the employee's employment history). Every read is scoped to the actor's
 * organization.
 */

const logger = createLogger("EmployeeReactivationActions");
const employeeIdSchema = z.uuid("Invalid employee ID");
const dismissSchema = z.strictObject({
	employeeId: employeeIdSchema,
	deactivationId: z.uuid("Invalid deactivation ID"),
});

export type DismissReactivationChecklistInput = z.input<typeof dismissSchema>;

function orgAdmin(action: "read" | "dismiss") {
	return Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: `reactivationChecklist.${action}:actor`,
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only organization owners and admins can see the reactivation checklist",
			resource: "employee",
			action: action === "read" ? "read_reactivation_checklist" : "dismiss_reactivation_checklist",
		});
		return actor;
	});
}

/**
 * What the employee's latest deactivation ended, once they were reactivated,
 * until an admin dismisses it; null otherwise.
 */
export async function getReactivationChecklistAction(
	employeeId: string,
): Promise<ServerActionResult<ReactivationChecklist | null>> {
	return runTracedEmployeeAction({
		name: "getReactivationChecklist",
		attributes: { "employee.id": employeeId },
		logError: (error) =>
			logger.error({ error, employeeId }, "Failed to load reactivation checklist"),
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* orgAdmin("read");
				const validEmployeeId = yield* validateInput(employeeIdSchema, employeeId, "employeeId");
				return yield* actor.dbService.query("reactivationChecklist.load", () =>
					loadReactivationChecklist(actor.dbService.db, {
						organizationId: actor.organizationId,
						employeeId: validEmployeeId,
					}),
				);
			}),
	});
}

/** Dismisses the checklist for every admin of the organization, for good. */
export async function dismissReactivationChecklistAction(
	input: DismissReactivationChecklistInput,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "dismissReactivationChecklist",
		logError: (error) => logger.error({ error }, "Failed to dismiss reactivation checklist"),
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* orgAdmin("dismiss");
				const data = yield* validateInput(dismissSchema, input, "employeeId");
				yield* actor.dbService.query("reactivationChecklist.dismiss", () =>
					dismissReactivationChecklist(actor.dbService.db, {
						organizationId: actor.organizationId,
						employeeId: data.employeeId,
						deactivationId: data.deactivationId,
						actorUserId: actor.session.user.id,
					}),
				);
			}),
	});
}

/** The employee's deactivations and reactivations, newest first, with the organization's zone. */
export async function listEmployeeLifecycleHistoryAction(
	employeeId: string,
): Promise<ServerActionResult<LifecycleHistory>> {
	return runTracedEmployeeAction({
		name: "listEmployeeLifecycleHistory",
		attributes: { "employee.id": employeeId },
		logError: (error) => logger.error({ error, employeeId }, "Failed to list lifecycle history"),
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					queryName: "listEmployeeLifecycleHistory:actor",
				});
				const validEmployeeId = yield* validateInput(employeeIdSchema, employeeId, "employeeId");
				const targetEmployee = yield* getTargetEmployee(validEmployeeId);
				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "read",
				});
				return yield* actor.dbService.query("listEmployeeLifecycleHistory", () =>
					loadLifecycleHistory(actor.dbService.db, {
						organizationId: actor.organizationId,
						employeeId: validEmployeeId,
					}),
				);
			}),
	});
}
