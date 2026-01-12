"use server";

import { and, eq, or } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, team, workScheduleAssignment, workScheduleTemplate } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type CreateWorkScheduleAssignment,
	createWorkScheduleAssignmentSchema,
} from "@/lib/validations/work-schedule";
import type { WorkScheduleTemplateWithDays } from "./actions";

// Types for return values
export type WorkScheduleAssignmentWithRelations = typeof workScheduleAssignment.$inferSelect & {
	template: WorkScheduleTemplateWithDays;
	team: typeof team.$inferSelect | null;
	employee: typeof employee.$inferSelect | null;
};

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

/**
 * Get all work schedule assignments for an organization
 */
export async function getWorkScheduleAssignments(
	organizationId: string,
): Promise<ServerActionResult<WorkScheduleAssignmentWithRelations[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_assignment",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const assignments = yield* _(
			dbService.query("getWorkScheduleAssignments", async () => {
				return await dbService.db.query.workScheduleAssignment.findMany({
					where: and(
						eq(workScheduleAssignment.organizationId, organizationId),
						eq(workScheduleAssignment.isActive, true),
					),
					with: {
						template: {
							with: {
								days: true,
							},
						},
						team: true,
						employee: true,
					},
					orderBy: (assignment, { asc }) => [asc(assignment.priority)],
				});
			}),
		);

		return assignments as WorkScheduleAssignmentWithRelations[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a work schedule assignment
 */
export async function createWorkScheduleAssignment(
	organizationId: string,
	data: CreateWorkScheduleAssignment,
): Promise<ServerActionResult<WorkScheduleAssignmentWithRelations>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_assignment",
						action: "create",
					}),
				),
			);
		}

		// Validate input
		const validationResult = createWorkScheduleAssignmentSchema.safeParse(data);
		if (!validationResult.success) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: validationResult.error.issues[0]?.message || "Validation failed",
						conflictType: "validation",
						details: { entityType: "work_schedule_assignment" },
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);

		// Verify template exists
		const template = yield* _(
			dbService.query("verifyTemplate", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: and(
						eq(workScheduleTemplate.id, data.templateId),
						eq(workScheduleTemplate.isActive, true),
					),
				});
			}),
		);

		if (!template) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: data.templateId,
					}),
				),
			);
		}

		// Check for existing assignment at the same level
		let existingAssignment;
		if (data.assignmentType === "organization") {
			existingAssignment = yield* _(
				dbService.query("checkOrgAssignment", async () => {
					return await dbService.db.query.workScheduleAssignment.findFirst({
						where: and(
							eq(workScheduleAssignment.organizationId, organizationId),
							eq(workScheduleAssignment.assignmentType, "organization"),
							eq(workScheduleAssignment.isActive, true),
						),
					});
				}),
			);
		} else if (data.assignmentType === "team" && data.teamId) {
			existingAssignment = yield* _(
				dbService.query("checkTeamAssignment", async () => {
					return await dbService.db.query.workScheduleAssignment.findFirst({
						where: and(
							eq(workScheduleAssignment.teamId, data.teamId!),
							eq(workScheduleAssignment.isActive, true),
						),
					});
				}),
			);
		} else if (data.assignmentType === "employee" && data.employeeId) {
			existingAssignment = yield* _(
				dbService.query("checkEmployeeAssignment", async () => {
					return await dbService.db.query.workScheduleAssignment.findFirst({
						where: and(
							eq(workScheduleAssignment.employeeId, data.employeeId!),
							eq(workScheduleAssignment.isActive, true),
						),
					});
				}),
			);
		}

		if (existingAssignment) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: `An assignment already exists at this ${data.assignmentType} level`,
						conflictType: "duplicate_assignment",
						details: { entityType: "work_schedule_assignment", field: data.assignmentType },
					}),
				),
			);
		}

		// Calculate priority
		const priority =
			data.assignmentType === "organization" ? 0 : data.assignmentType === "team" ? 1 : 2;

		// Create assignment
		const [newAssignment] = yield* _(
			dbService.query("createAssignment", async () => {
				return await dbService.db
					.insert(workScheduleAssignment)
					.values({
						templateId: data.templateId,
						organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						effectiveFrom: data.effectiveFrom ?? null,
						effectiveUntil: data.effectiveUntil ?? null,
						createdBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		// Fetch complete assignment with relations
		const completeAssignment = yield* _(
			dbService.query("fetchComplete", async () => {
				return await dbService.db.query.workScheduleAssignment.findFirst({
					where: eq(workScheduleAssignment.id, newAssignment.id),
					with: {
						template: {
							with: {
								days: true,
							},
						},
						team: true,
						employee: true,
					},
				});
			}),
		);

		if (!completeAssignment) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch created assignment",
						entityType: "work_schedule_assignment",
					}),
				),
			);
		}

		return completeAssignment as WorkScheduleAssignmentWithRelations;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete (soft delete) a work schedule assignment
 */
export async function deleteWorkScheduleAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get existing assignment
		const existingAssignment = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workScheduleAssignment.findFirst({
					where: eq(workScheduleAssignment.id, assignmentId),
				});
			}),
		);

		if (!existingAssignment) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Assignment not found",
						entityType: "work_schedule_assignment",
						entityId: assignmentId,
					}),
				),
			);
		}

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, existingAssignment.organizationId)),
		);

		if (!hasPermission) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("softDelete", async () => {
				await dbService.db
					.update(workScheduleAssignment)
					.set({
						isActive: false,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workScheduleAssignment.id, assignmentId));
			}),
		);

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// Type for effective schedule with assignment details
export type EffectiveScheduleWithSource = {
	template: WorkScheduleTemplateWithDays;
	assignmentType: "organization" | "team" | "employee";
	assignedVia: string; // "Organization Default", team name, or "Individual"
	weeklyHours: number;
};

/**
 * Get the effective work schedule for an employee with assignment source details
 * Returns the schedule with the highest priority (employee > team > organization)
 * along with information about where the assignment came from
 */
export async function getEmployeeEffectiveScheduleDetails(
	employeeId: string,
): Promise<ServerActionResult<EffectiveScheduleWithSource | null>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Get the employee
		const emp = yield* _(
			dbService.query("getEmployeeDetails", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
				});
			}),
		);

		if (!emp || !emp.organizationId) {
			return null;
		}

		// Get all potential assignments for this employee (employee, team, org)
		// Priority: 2 (employee) > 1 (team) > 0 (organization)
		const assignments = yield* _(
			dbService.query("getAssignmentsDetails", async () => {
				return await dbService.db.query.workScheduleAssignment.findMany({
					where: and(
						eq(workScheduleAssignment.organizationId, emp.organizationId),
						eq(workScheduleAssignment.isActive, true),
						or(
							// Employee-specific assignment
							eq(workScheduleAssignment.employeeId, employeeId),
							// Team assignment (if employee has a team)
							emp.teamId ? eq(workScheduleAssignment.teamId, emp.teamId) : undefined,
							// Organization-wide assignment
							eq(workScheduleAssignment.assignmentType, "organization"),
						),
					),
					with: {
						template: {
							with: {
								days: true,
							},
						},
						team: true,
					},
					orderBy: (assignment, { desc }) => [desc(assignment.priority)],
				});
			}),
		);

		// Return the highest priority assignment's template with source info
		const effectiveAssignment = assignments[0];
		if (!effectiveAssignment) {
			return null;
		}

		// Calculate weekly hours
		let weeklyHours = 0;
		if (
			effectiveAssignment.template.scheduleType === "simple" &&
			effectiveAssignment.template.hoursPerCycle
		) {
			const hoursPerCycle = parseFloat(effectiveAssignment.template.hoursPerCycle);
			switch (effectiveAssignment.template.scheduleCycle) {
				case "weekly":
					weeklyHours = hoursPerCycle;
					break;
				case "biweekly":
					weeklyHours = hoursPerCycle / 2;
					break;
				case "monthly":
					weeklyHours = (hoursPerCycle * 12) / 52;
					break;
				case "yearly":
					weeklyHours = hoursPerCycle / 52;
					break;
				case "daily":
					weeklyHours = hoursPerCycle * 7;
					break;
			}
		} else if (effectiveAssignment.template.days) {
			weeklyHours = effectiveAssignment.template.days
				.filter((d) => d.isWorkDay)
				.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);
		}

		// Determine assignment source description
		let assignedVia = "Organization Default";
		if (effectiveAssignment.assignmentType === "team" && effectiveAssignment.team) {
			assignedVia = `Team: ${effectiveAssignment.team.name}`;
		} else if (effectiveAssignment.assignmentType === "employee") {
			assignedVia = "Individual";
		}

		return {
			template: effectiveAssignment.template as WorkScheduleTemplateWithDays,
			assignmentType: effectiveAssignment.assignmentType,
			assignedVia,
			weeklyHours: Math.round(weeklyHours * 100) / 100,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get the effective work schedule for an employee
 * Returns the schedule with the highest priority (employee > team > organization)
 */
export async function getEmployeeEffectiveSchedule(
	employeeId: string,
): Promise<ServerActionResult<WorkScheduleTemplateWithDays | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get the employee
		const emp = yield* _(
			dbService.query("getEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
				});
			}),
		);

		if (!emp) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				),
			);
		}

		// Get all potential assignments for this employee (employee, team, org)
		// Priority: 2 (employee) > 1 (team) > 0 (organization)
		const assignments = yield* _(
			dbService.query("getAssignments", async () => {
				return await dbService.db.query.workScheduleAssignment.findMany({
					where: and(
						eq(workScheduleAssignment.organizationId, emp!.organizationId),
						eq(workScheduleAssignment.isActive, true),
						or(
							// Employee-specific assignment
							eq(workScheduleAssignment.employeeId, employeeId),
							// Team assignment (if employee has a team)
							emp!.teamId ? eq(workScheduleAssignment.teamId, emp!.teamId) : undefined,
							// Organization-wide assignment
							eq(workScheduleAssignment.assignmentType, "organization"),
						),
					),
					with: {
						template: {
							with: {
								days: true,
							},
						},
					},
					orderBy: (assignment, { desc }) => [desc(assignment.priority)],
				});
			}),
		);

		// Return the highest priority assignment's template, or null if none exists
		const effectiveAssignment = assignments[0];
		return effectiveAssignment ? effectiveAssignment.template : null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all teams for an organization (for assignment dropdown)
 */
export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<(typeof team.$inferSelect)[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "team",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const teams = yield* _(
			dbService.query("getTeams", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					orderBy: (t, { asc }) => [asc(t.name)],
				});
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all employees for an organization (for assignment dropdown)
 */
export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<ServerActionResult<(typeof employee.$inferSelect)[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "employee",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const employees = yield* _(
			dbService.query("getEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					orderBy: (e, { asc }) => [asc(e.firstName), asc(e.lastName)],
				});
			}),
		);

		return employees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// Type for bulk assignment input
interface BulkCreateWorkScheduleAssignments {
	templateId: string;
	assignmentType: "team" | "employee";
	teamIds?: string[];
	employeeIds?: string[];
}

/**
 * Bulk create work schedule assignments
 * Creates multiple assignments at once, skipping any that already exist
 */
export async function bulkCreateWorkScheduleAssignments(
	organizationId: string,
	data: BulkCreateWorkScheduleAssignments,
): Promise<ServerActionResult<{ created: number; skipped: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_schedule_assignment",
						action: "create",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);

		// Verify template exists
		const template = yield* _(
			dbService.query("verifyTemplate", async () => {
				return await dbService.db.query.workScheduleTemplate.findFirst({
					where: and(
						eq(workScheduleTemplate.id, data.templateId),
						eq(workScheduleTemplate.isActive, true),
					),
				});
			}),
		);

		if (!template) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Template not found",
						entityType: "work_schedule_template",
						entityId: data.templateId,
					}),
				),
			);
		}

		let created = 0;
		let skipped = 0;

		if (data.assignmentType === "team" && data.teamIds) {
			// Get existing team assignments
			const existingTeamAssignments = yield* _(
				dbService.query("getExistingTeamAssignments", async () => {
					return await dbService.db.query.workScheduleAssignment.findMany({
						where: and(
							eq(workScheduleAssignment.organizationId, organizationId),
							eq(workScheduleAssignment.assignmentType, "team"),
							eq(workScheduleAssignment.isActive, true),
						),
					});
				}),
			);

			const existingTeamIds = new Set(existingTeamAssignments.map((a) => a.teamId).filter(Boolean));

			// Create assignments for teams that don't have one
			for (const teamId of data.teamIds) {
				if (existingTeamIds.has(teamId)) {
					skipped++;
					continue;
				}

				yield* _(
					dbService.query(`createTeamAssignment-${teamId}`, async () => {
						await dbService.db.insert(workScheduleAssignment).values({
							templateId: data.templateId,
							organizationId,
							assignmentType: "team",
							teamId,
							employeeId: null,
							priority: 1,
							createdBy: session.user.id,
							updatedAt: currentTimestamp(),
						});
					}),
				);
				created++;
			}
		} else if (data.assignmentType === "employee" && data.employeeIds) {
			// Get existing employee assignments
			const existingEmployeeAssignments = yield* _(
				dbService.query("getExistingEmployeeAssignments", async () => {
					return await dbService.db.query.workScheduleAssignment.findMany({
						where: and(
							eq(workScheduleAssignment.organizationId, organizationId),
							eq(workScheduleAssignment.assignmentType, "employee"),
							eq(workScheduleAssignment.isActive, true),
						),
					});
				}),
			);

			const existingEmployeeIds = new Set(
				existingEmployeeAssignments.map((a) => a.employeeId).filter(Boolean),
			);

			// Create assignments for employees that don't have one
			for (const employeeId of data.employeeIds) {
				if (existingEmployeeIds.has(employeeId)) {
					skipped++;
					continue;
				}

				yield* _(
					dbService.query(`createEmployeeAssignment-${employeeId}`, async () => {
						await dbService.db.insert(workScheduleAssignment).values({
							templateId: data.templateId,
							organizationId,
							assignmentType: "employee",
							teamId: null,
							employeeId,
							priority: 2,
							createdBy: session.user.id,
							updatedAt: currentTimestamp(),
						});
					}),
				);
				created++;
			}
		}

		return { created, skipped };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
