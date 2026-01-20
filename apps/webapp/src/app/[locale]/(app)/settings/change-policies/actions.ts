"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	changePolicy,
	changePolicyAssignment,
	employee,
	team,
} from "@/db/schema";
import {
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

// ============================================
// TYPES
// ============================================

export type ChangePolicyRecord = typeof changePolicy.$inferSelect;

export type ChangePolicyAssignmentWithDetails = typeof changePolicyAssignment.$inferSelect & {
	policy: {
		id: string;
		name: string;
		selfServiceDays: number;
		approvalDays: number;
		noApprovalRequired: boolean;
	} | null;
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
};

export interface CreateChangePolicyInput {
	name: string;
	description?: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
}

export interface UpdateChangePolicyInput {
	name?: string;
	description?: string;
	selfServiceDays?: number;
	approvalDays?: number;
	noApprovalRequired?: boolean;
	notifyAllManagers?: boolean;
	isActive?: boolean;
}

export interface CreateAssignmentInput {
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
	effectiveFrom?: Date;
	effectiveUntil?: Date;
}

// ============================================
// GET POLICIES
// ============================================

/**
 * Get all change policies for an organization
 */
export async function getChangePolicies(
	organizationId: string,
): Promise<ServerActionResult<ChangePolicyRecord[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const policies = yield* _(
			dbService.query("getChangePolicies", async () => {
				return await dbService.db.query.changePolicy.findMany({
					where: and(
						eq(changePolicy.organizationId, organizationId),
						eq(changePolicy.isActive, true),
					),
					orderBy: [desc(changePolicy.createdAt)],
				});
			}),
		);

		return policies;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get a single change policy by ID
 */
export async function getChangePolicy(
	policyId: string,
): Promise<ServerActionResult<ChangePolicyRecord | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const policy = yield* _(
			dbService.query("getChangePolicy", async () => {
				return await dbService.db.query.changePolicy.findFirst({
					where: eq(changePolicy.id, policyId),
				});
			}),
		);

		return policy ?? null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// CREATE POLICY
// ============================================

/**
 * Create a new change policy
 */
export async function createChangePolicy(
	organizationId: string,
	data: CreateChangePolicyInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "change_policy",
						action: "create",
					}),
				),
			);
		}

		// Validate input
		if (!data.name || data.name.trim().length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Policy name is required",
						field: "name",
					}),
				),
			);
		}

		if (data.selfServiceDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Self-service days cannot be negative",
						field: "selfServiceDays",
					}),
				),
			);
		}

		if (data.approvalDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Approval days cannot be negative",
						field: "approvalDays",
					}),
				),
			);
		}

		// Create policy
		const [policy] = yield* _(
			dbService.query("createChangePolicy", async () => {
				return await dbService.db
					.insert(changePolicy)
					.values({
						organizationId: organizationId,
						name: data.name.trim(),
						description: data.description?.trim(),
						selfServiceDays: data.selfServiceDays,
						approvalDays: data.approvalDays,
						noApprovalRequired: data.noApprovalRequired ?? false,
						notifyAllManagers: data.notifyAllManagers ?? false,
						createdBy: session.user.id,
						updatedAt: new Date(),
					})
					.returning();
			}),
		);

		return { id: policy.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE POLICY
// ============================================

/**
 * Update an existing change policy
 */
export async function updateChangePolicy(
	policyId: string,
	data: UpdateChangePolicyInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "change_policy",
						action: "update",
					}),
				),
			);
		}

		// Verify policy exists and belongs to org
		const existingPolicy = yield* _(
			dbService.query("verifyPolicy", async () => {
				const [pol] = await dbService.db
					.select()
					.from(changePolicy)
					.where(
						and(
							eq(changePolicy.id, policyId),
							eq(changePolicy.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!pol) throw new Error("Policy not found");
				return pol;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Change policy not found",
						entityType: "change_policy",
						entityId: policyId,
					}),
			),
		);

		// Validate input
		if (data.name !== undefined && data.name.trim().length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Policy name cannot be empty",
						field: "name",
					}),
				),
			);
		}

		if (data.selfServiceDays !== undefined && data.selfServiceDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Self-service days cannot be negative",
						field: "selfServiceDays",
					}),
				),
			);
		}

		if (data.approvalDays !== undefined && data.approvalDays < 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Approval days cannot be negative",
						field: "approvalDays",
					}),
				),
			);
		}

		// Update policy
		yield* _(
			dbService.query("updateChangePolicy", async () => {
				await dbService.db
					.update(changePolicy)
					.set({
						...(data.name !== undefined && { name: data.name.trim() }),
						...(data.description !== undefined && { description: data.description?.trim() }),
						...(data.selfServiceDays !== undefined && { selfServiceDays: data.selfServiceDays }),
						...(data.approvalDays !== undefined && { approvalDays: data.approvalDays }),
						...(data.noApprovalRequired !== undefined && {
							noApprovalRequired: data.noApprovalRequired,
						}),
						...(data.notifyAllManagers !== undefined && {
							notifyAllManagers: data.notifyAllManagers,
						}),
						...(data.isActive !== undefined && { isActive: data.isActive }),
						updatedBy: session.user.id,
					})
					.where(eq(changePolicy.id, policyId));
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DELETE POLICY
// ============================================

/**
 * Soft delete a change policy
 */
export async function deleteChangePolicy(
	policyId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "change_policy",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deleteChangePolicy", async () => {
				await dbService.db
					.update(changePolicy)
					.set({ isActive: false, updatedBy: session.user.id })
					.where(
						and(
							eq(changePolicy.id, policyId),
							eq(changePolicy.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// ASSIGNMENTS
// ============================================

/**
 * Get all assignments for an organization
 */
export async function getChangePolicyAssignments(
	organizationId: string,
): Promise<ServerActionResult<ChangePolicyAssignmentWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const assignments = yield* _(
			dbService.query("getChangePolicyAssignments", async () => {
				return await dbService.db.query.changePolicyAssignment.findMany({
					where: and(
						eq(changePolicyAssignment.organizationId, organizationId),
						eq(changePolicyAssignment.isActive, true),
					),
					with: {
						policy: {
							columns: {
								id: true,
								name: true,
								selfServiceDays: true,
								approvalDays: true,
								noApprovalRequired: true,
							},
						},
						team: {
							columns: { id: true, name: true },
						},
						employee: {
							columns: { id: true, firstName: true, lastName: true },
						},
					},
					orderBy: [desc(changePolicyAssignment.priority), desc(changePolicyAssignment.createdAt)],
				});
			}),
		);

		return assignments as ChangePolicyAssignmentWithDetails[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a new assignment
 */
export async function createChangePolicyAssignment(
	organizationId: string,
	data: CreateAssignmentInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "change_policy_assignment",
						action: "create",
					}),
				),
			);
		}

		// Validate assignment type requirements
		if (data.assignmentType === "team" && !data.teamId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Team ID is required for team assignments",
						field: "teamId",
					}),
				),
			);
		}

		if (data.assignmentType === "employee" && !data.employeeId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Employee ID is required for employee assignments",
						field: "employeeId",
					}),
				),
			);
		}

		// Determine priority based on assignment type
		const priority =
			data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		// Create assignment
		const [assignment] = yield* _(
			dbService.query("createChangePolicyAssignment", async () => {
				return await dbService.db
					.insert(changePolicyAssignment)
					.values({
						policyId: data.policyId,
						organizationId: organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						effectiveFrom: data.effectiveFrom,
						effectiveUntil: data.effectiveUntil,
						isActive: true,
						createdBy: session.user.id,
						updatedAt: new Date(),
					})
					.returning();
			}),
		);

		return { id: assignment.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete an assignment (soft delete)
 */
export async function deleteChangePolicyAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "change_policy_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deleteChangePolicyAssignment", async () => {
				await dbService.db
					.update(changePolicyAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(changePolicyAssignment.id, assignmentId),
							eq(changePolicyAssignment.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// HELPER QUERIES
// ============================================

/**
 * Get available teams for assignment dropdown
 */
export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const teams = yield* _(
			dbService.query("getTeamsForAssignment", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: [team.name],
				});
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get available employees for assignment dropdown
 */
export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; firstName: string | null; lastName: string | null }[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const employees = yield* _(
			dbService.query("getEmployeesForAssignment", async () => {
				return await dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					columns: { id: true, firstName: true, lastName: true },
					orderBy: [employee.lastName, employee.firstName],
				});
			}),
		);

		return employees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
