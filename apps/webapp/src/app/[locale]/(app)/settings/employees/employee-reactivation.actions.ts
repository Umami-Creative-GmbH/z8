"use server";

import { Effect } from "effect";
import { z } from "zod";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { loadLifecycleHistory } from "@/lib/employee-lifecycle/lifecycle-history";
import {
	dismissReactivationChecklist,
	loadReactivationChecklist,
} from "@/lib/employee-lifecycle/reactivation-checklist-store";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { loadManagedEmployee } from "./managed-employee";

/**
 * Reactivation (#1441): the re-grant checklist (org admins) and the
 * deactivations and reactivations in the employment history (whoever may read
 * the employee's employment history). Every read is scoped to the actor's
 * organization.
 */

const employeeIdSchema = z.uuid("Invalid employee ID");
const dismissSchema = z.strictObject({
	employeeId: employeeIdSchema,
	deactivationId: z.uuid("Invalid deactivation ID"),
});

export type DismissReactivationChecklistInput = z.input<typeof dismissSchema>;

/**
 * What the employee's latest deactivation ended, once they were reactivated,
 * until an admin dismisses it; null otherwise.
 */
export const getReactivationChecklistAction = organizationAction(
	{ name: "reactivationChecklist.load", requires: "orgAdmin", schema: employeeIdSchema },
	({ organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("reactivationChecklist.load", () =>
				loadReactivationChecklist(dbService.db, { organizationId, employeeId }),
			);
		}),
);

/** Dismisses the checklist for every admin of the organization, for good. */
export const dismissReactivationChecklistAction = organizationAction(
	{ name: "reactivationChecklist.dismiss", requires: "orgAdmin", schema: dismissSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("reactivationChecklist.dismiss", () =>
				dismissReactivationChecklist(dbService.db, {
					organizationId,
					employeeId: input.employeeId,
					deactivationId: input.deactivationId,
					actorUserId: actor.userId,
				}),
			);
		}),
);

/** The employee's deactivations and reactivations, newest first, with the organization's zone. */
export const listEmployeeLifecycleHistoryAction = organizationAction(
	{
		name: "employees.listLifecycleHistory",
		requires: "scopedManager",
		schema: employeeIdSchema,
	},
	(context) =>
		Effect.gen(function* () {
			const employeeId = context.input;
			yield* loadManagedEmployee(context, employeeId, {
				queryName: "listEmployeeLifecycleHistory:target",
				message: "You do not have access to this employee's employment history",
			});
			const dbService = yield* DatabaseService;
			return yield* dbService.query("listEmployeeLifecycleHistory", () =>
				loadLifecycleHistory(dbService.db, {
					organizationId: context.organizationId,
					employeeId,
				}),
			);
		}),
);
