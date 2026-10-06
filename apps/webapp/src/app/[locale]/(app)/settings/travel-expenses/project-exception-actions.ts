"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, project } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import type { ProjectAttributionExceptionError } from "@/lib/travel-expenses/project-attribution-exception";
import {
	authorizeProjectAttributionException,
	type ExceptionActor,
	listProjectAttributionExceptions,
	type ProjectAttributionExceptionView,
} from "@/lib/travel-expenses/project-attribution-exception-store";

/**
 * Authorized project attribution exceptions (#605). Only an organization
 * expense administrator (who may manage the organization's settings) records
 * them, never for their own expenses, and every referenced employee and
 * project must belong to the active organization.
 */

async function requireExpenseAdministrator(): Promise<{ error: string } | ExceptionActor> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext) return { error: "Unauthorized: Admin access required" };
	if (!organizationId) return { error: "No organization selected" };
	if (!(await canManageCurrentOrganizationSettings())) {
		return { error: "Unauthorized: Admin access required" };
	}
	const actor = authContext.employee;
	// The authorization is attributed to the administrator's employee profile.
	if (!actor || actor.organizationId !== organizationId) {
		return { error: "An employee profile in this organization is required" };
	}
	return { organizationId, employeeId: actor.id, userId: authContext.user.id };
}

export interface ProjectExceptionSettings {
	exceptions: ProjectAttributionExceptionView[];
	/** Employees other than the administrator, who never authorizes their own. */
	employees: { id: string; name: string }[];
	/** Every project, closed ones included. */
	projects: { id: string; name: string; status: string }[];
}

export async function getProjectAttributionExceptionSettings(): Promise<
	ServerActionResult<ProjectExceptionSettings>
> {
	try {
		const access = await requireExpenseAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const [exceptions, employees, projects] = await Promise.all([
			listProjectAttributionExceptions(db, access.organizationId),
			db
				.select({ id: employee.id, name: user.name })
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(eq(employee.organizationId, access.organizationId))
				.orderBy(asc(user.name), asc(employee.id)),
			db
				.select({ id: project.id, name: project.name, status: project.status })
				.from(project)
				.where(eq(project.organizationId, access.organizationId))
				.orderBy(asc(project.name)),
		]);
		return {
			success: true,
			data: {
				exceptions,
				employees: employees.filter((row) => row.id !== access.employeeId),
				projects,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load project attribution exceptions");
		return { success: false, error: "Failed to load project attribution exceptions" };
	}
}

export type AuthorizeProjectExceptionOutcome =
	| { status: "authorized"; exceptionId: string }
	| { status: "invalid"; errors: ProjectAttributionExceptionError[] };

const inputSchema = z.object({
	employeeId: z.uuid(),
	projectId: z.uuid(),
	validFrom: z.string().max(10),
	validTo: z.string().max(10),
	reason: z.string().max(5000),
	evidence: z.string().max(5000),
});

export async function authorizeProjectAttributionExceptionAction(
	input: z.input<typeof inputSchema>,
): Promise<ServerActionResult<AuthorizeProjectExceptionOutcome>> {
	try {
		const access = await requireExpenseAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const parsed = inputSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid exception" };
		const result = await authorizeProjectAttributionException(db, access, parsed.data);
		switch (result.kind) {
			case "invalid":
				return { success: true, data: { status: "invalid", errors: result.errors } };
			case "self_authorization":
				return {
					success: false,
					error: "You cannot authorize an exception for your own expenses",
				};
			case "employee_not_found":
				return { success: false, error: "Employee not found" };
			case "project_not_found":
				return { success: false, error: "Project not found" };
			case "authorized":
				break;
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_PROJECT_EXCEPTION_AUTHORIZED,
			actorId: access.userId,
			employeeId: parsed.data.employeeId,
			targetId: result.exceptionId,
			targetType: "project_assignment",
			organizationId: access.organizationId,
			metadata: {
				projectId: parsed.data.projectId,
				validFrom: parsed.data.validFrom,
				validTo: parsed.data.validTo,
			},
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log project exception"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { status: "authorized", exceptionId: result.exceptionId } };
	} catch (error) {
		logger.error({ error }, "Failed to authorize project attribution exception");
		return { success: false, error: "Failed to authorize the exception" };
	}
}
