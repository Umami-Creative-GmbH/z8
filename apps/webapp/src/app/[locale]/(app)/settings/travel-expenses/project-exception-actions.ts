"use server";

import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import type { ProjectAttributionExceptionError } from "@/lib/travel-expenses/project-attribution-exception";
import {
	authorizeProjectAttributionException,
	listProjectAttributionExceptions,
	type ProjectAttributionExceptionView,
} from "@/lib/travel-expenses/project-attribution-exception-store";
import {
	auditLater,
	expenseAdministrator,
	expenseStore,
	revalidateExpenseSettings,
} from "./expense-settings-effects";

/**
 * Authorized project attribution exceptions (#605). Only an org admin with an
 * employee profile in the session's organization records them, never for
 * their own expenses, and every referenced employee and project must belong
 * to that organization.
 */

export interface ProjectExceptionSettings {
	exceptions: ProjectAttributionExceptionView[];
	/** Employees other than the administrator, who never authorizes their own. */
	employees: { id: string; name: string }[];
	/** Every project, closed ones included. */
	projects: { id: string; name: string; status: string }[];
}

export const getProjectAttributionExceptionSettings = organizationAction(
	{ name: "travelExpenses.getProjectExceptions", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const [exceptions, employees, projects] = yield* expenseStore(
				"travelExpenses.getProjectExceptions",
				"Failed to load project attribution exceptions",
				(database) =>
					Promise.all([
						listProjectAttributionExceptions(database, organizationId),
						database
							.select({ id: employee.id, name: user.name })
							.from(employee)
							.innerJoin(user, eq(user.id, employee.userId))
							.where(eq(employee.organizationId, organizationId))
							.orderBy(asc(user.name), asc(employee.id)),
						database
							.select({ id: project.id, name: project.name, status: project.status })
							.from(project)
							.where(eq(project.organizationId, organizationId))
							.orderBy(asc(project.name)),
					]),
			);
			return {
				exceptions,
				employees: employees.filter((row) => row.id !== admin.employeeId),
				projects,
			} satisfies ProjectExceptionSettings;
		}),
);

export type AuthorizeProjectExceptionOutcome =
	| { status: "authorized"; exceptionId: string }
	| { status: "invalid"; errors: ProjectAttributionExceptionError[] };

const invalidException = "Invalid exception";
const inputSchema = z.object(
	{
		employeeId: z.uuid(invalidException),
		projectId: z.uuid(invalidException),
		validFrom: z.string(invalidException).max(10, invalidException),
		validTo: z.string(invalidException).max(10, invalidException),
		reason: z.string(invalidException).max(5000, invalidException),
		evidence: z.string(invalidException).max(5000, invalidException),
	},
	invalidException,
);

export const authorizeProjectAttributionExceptionAction = organizationAction(
	{ name: "travelExpenses.authorizeProjectException", requires: "orgAdmin", schema: inputSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const result = yield* expenseStore(
				"travelExpenses.authorizeProjectException",
				"Failed to authorize the exception",
				(database) => authorizeProjectAttributionException(database, admin, input),
			);
			switch (result.kind) {
				case "invalid":
					return {
						status: "invalid",
						errors: result.errors,
					} satisfies AuthorizeProjectExceptionOutcome;
				case "self_authorization":
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You cannot authorize an exception for your own expenses",
							userId: actor.userId,
							resource: "travelExpenses.authorizeProjectException",
						}),
					);
				case "employee_not_found":
					return yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: input.employeeId,
						}),
					);
				case "project_not_found":
					return yield* Effect.fail(
						new NotFoundError({
							message: "Project not found",
							entityType: "project",
							entityId: input.projectId,
						}),
					);
				case "authorized":
					break;
			}
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_PROJECT_EXCEPTION_AUTHORIZED,
						actorId: actor.userId,
						employeeId: input.employeeId,
						targetId: result.exceptionId,
						targetType: "project_assignment",
						organizationId,
						metadata: {
							projectId: input.projectId,
							validFrom: input.validFrom,
							validTo: input.validTo,
						},
						timestamp: new Date(),
					}),
				"Failed to log project exception",
			);
			yield* revalidateExpenseSettings();
			return {
				status: "authorized",
				exceptionId: result.exceptionId,
			} satisfies AuthorizeProjectExceptionOutcome;
		}),
);
