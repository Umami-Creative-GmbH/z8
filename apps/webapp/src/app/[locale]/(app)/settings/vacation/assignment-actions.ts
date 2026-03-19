"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee, team, vacationAllowance, vacationPolicyAssignment } from "@/db/schema";
import { AuthorizationError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	filterItemsToManagedEmployees,
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
	getOrganizationTeam,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
	requireSettingsActorEmployeeAssignmentAccess,
	validateAssignmentTargetFields,
} from "../employees/employee-action-utils";

// ============================================
// VACATION POLICY ASSIGNMENTS (Policies to org/team/employee)
// ============================================

/**
 * Get all vacation policies for an organization
 */
export async function getVacationPolicies(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getVacationPoliciesForAssignment:actor" }),
		);
		const dbService = yield* _(DatabaseService);

		// Step 3: Get policies from database
		const policies = yield* _(
			dbService.query("getVacationPolicies", async () => {
				return await dbService.db
					.select()
					.from(vacationAllowance)
					.where(eq(vacationAllowance.organizationId, organizationId))
					.orderBy(vacationAllowance.startDate);
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch vacation policies",
						operation: "select",
						table: "vacation_allowance",
						cause: error,
					}),
			),
		);

		return policies;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all vacation policy assignments for an organization
 */
export async function getVacationPolicyAssignments(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getVacationPolicyAssignments:actor" }),
		);
		const dbService = yield* _(DatabaseService);
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));

		// Step 3: Get assignments from database with policy, team, and employee info
		const assignments = yield* _(
			dbService.query("getVacationPolicyAssignments", async () => {
				return await dbService.db
					.select({
						id: vacationPolicyAssignment.id,
						policyId: vacationPolicyAssignment.policyId,
						organizationId: vacationPolicyAssignment.organizationId,
						assignmentType: vacationPolicyAssignment.assignmentType,
						teamId: vacationPolicyAssignment.teamId,
						employeeId: vacationPolicyAssignment.employeeId,
						priority: vacationPolicyAssignment.priority,
						effectiveFrom: vacationPolicyAssignment.effectiveFrom,
						effectiveUntil: vacationPolicyAssignment.effectiveUntil,
						isActive: vacationPolicyAssignment.isActive,
						createdAt: vacationPolicyAssignment.createdAt,
						policy: {
							id: vacationAllowance.id,
							name: vacationAllowance.name,
							startDate: vacationAllowance.startDate,
							validUntil: vacationAllowance.validUntil,
							isCompanyDefault: vacationAllowance.isCompanyDefault,
							defaultAnnualDays: vacationAllowance.defaultAnnualDays,
							accrualType: vacationAllowance.accrualType,
							allowCarryover: vacationAllowance.allowCarryover,
							maxCarryoverDays: vacationAllowance.maxCarryoverDays,
						},
						team: {
							id: team.id,
							name: team.name,
						},
						employee: {
							id: employee.id,
							firstName: employee.firstName,
							lastName: employee.lastName,
						},
					})
					.from(vacationPolicyAssignment)
					.innerJoin(vacationAllowance, eq(vacationPolicyAssignment.policyId, vacationAllowance.id))
					.leftJoin(team, eq(vacationPolicyAssignment.teamId, team.id))
					.leftJoin(employee, eq(vacationPolicyAssignment.employeeId, employee.id))
					.where(
						and(
							eq(vacationPolicyAssignment.organizationId, organizationId),
							eq(vacationPolicyAssignment.isActive, true),
						),
					)
					.orderBy(vacationAllowance.startDate);
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch vacation policy assignments",
						operation: "select",
						table: "vacation_policy_assignment",
						cause: error,
					}),
			),
		);

		if (!managedEmployeeIds) {
			return assignments;
		}

		return filterItemsToManagedEmployees(
			assignments.filter((assignment) => assignment.assignmentType === "employee"),
			managedEmployeeIds,
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a vacation policy assignment
 */
export async function createVacationPolicyAssignment(data: {
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
}): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const policy = yield* _(
			dbService.query("verifyPolicy", async () => {
				const [p] = await dbService.db
					.select()
					.from(vacationAllowance)
					.where(eq(vacationAllowance.id, data.policyId))
					.limit(1);

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Vacation policy not found",
						entityType: "vacation_policy",
						entityId: data.policyId,
					}),
			),
		);
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: policy.organizationId,
				queryName: "createVacationPolicyAssignment:actor",
			}),
		);
		yield* _(
			requireSettingsActorEmployeeAssignmentAccess(actor, data.assignmentType, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "create",
			}),
		);
		yield* _(validateAssignmentTargetFields(data.assignmentType, data));

		if (data.assignmentType !== "employee") {
			yield* _(
				requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Insufficient permissions",
					resource: "vacation_policy_assignment",
					action: "create",
				}),
			);
		}

		if (data.employeeId) {
			const targetEmployee = yield* _(
				getTargetEmployee(data.employeeId, "createVacationPolicyAssignment:getTargetEmployee"),
			);
			yield* _(
				ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "Insufficient permissions",
					resource: "vacation_policy_assignment",
					action: "create",
				}),
			);
		}

		if (data.assignmentType === "team" && data.teamId) {
			yield* _(
				getOrganizationTeam(
					data.teamId,
					actor.organizationId,
					"createVacationPolicyAssignment:getOrganizationTeam",
				),
			);
		}

		// Step 6: Calculate priority based on assignment type
		const priority =
			data.assignmentType === "organization" ? 0 : data.assignmentType === "team" ? 1 : 2;

		// Step 7: Create the assignment
		const newAssignment = yield* _(
				dbService.query("createVacationPolicyAssignment", async () => {
					const [assignment] = await dbService.db
						.insert(vacationPolicyAssignment)
						.values({
							policyId: data.policyId,
							organizationId: actor.organizationId,
							assignmentType: data.assignmentType,
							teamId: data.teamId || null,
							employeeId: data.employeeId || null,
							priority,
							createdBy: actor.session.user.id,
						})
					.returning();

				return assignment;
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create vacation policy assignment",
						operation: "insert",
						table: "vacation_policy_assignment",
						cause: error,
					}),
			),
		);

		return newAssignment;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get a specific employee's direct policy assignment (if any)
 */
export async function getEmployeePolicyAssignment(
	employeeId: string,
): Promise<ServerActionResult<any | null>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "getEmployeePolicyAssignment:actor" }));
		const targetEmployee = yield* _(
			getTargetEmployee(employeeId, "getEmployeePolicyAssignment:getTargetEmployee"),
		);
		yield* _(
			ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "read",
			}),
		);
		const dbService = yield* _(DatabaseService);

		const assignment = yield* _(
			dbService.query("getEmployeePolicyAssignment", async () => {
				const [result] = await dbService.db
					.select({
						id: vacationPolicyAssignment.id,
						policyId: vacationPolicyAssignment.policyId,
						policy: {
							id: vacationAllowance.id,
							name: vacationAllowance.name,
							startDate: vacationAllowance.startDate,
							validUntil: vacationAllowance.validUntil,
							defaultAnnualDays: vacationAllowance.defaultAnnualDays,
						},
					})
					.from(vacationPolicyAssignment)
					.innerJoin(vacationAllowance, eq(vacationPolicyAssignment.policyId, vacationAllowance.id))
					.where(
						and(
							eq(vacationPolicyAssignment.employeeId, employeeId),
							eq(vacationPolicyAssignment.assignmentType, "employee"),
							eq(vacationPolicyAssignment.isActive, true),
						),
					)
					.limit(1);

				return result || null;
			}),
		);

		return assignment;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Set or clear an employee's direct policy assignment
 */
export async function setEmployeePolicyAssignment(
	employeeId: string,
	policyId: string | null,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "setEmployeePolicyAssignment:actor" }));
		const targetEmployee = yield* _(
			getTargetEmployee(employeeId, "setEmployeePolicyAssignment:getTargetEmployee"),
		);
		yield* _(
			ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "update",
			}),
		);
		const dbService = yield* _(DatabaseService);

		// First, deactivate any existing employee assignment
		yield* _(
			dbService.query("deactivateExisting", async () => {
				await dbService.db
					.update(vacationPolicyAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(vacationPolicyAssignment.employeeId, employeeId),
							eq(vacationPolicyAssignment.assignmentType, "employee"),
							eq(vacationPolicyAssignment.isActive, true),
						),
					);
			}),
		);

		// If policyId provided, create new assignment
		if (policyId) {
			// Verify policy exists and belongs to same org
			const _existingPolicy = yield* _(
				dbService.query("verifyPolicy", async () => {
					const [p] = await dbService.db
						.select()
						.from(vacationAllowance)
						.where(
							and(
								eq(vacationAllowance.id, policyId),
								eq(vacationAllowance.organizationId, actor.organizationId),
							),
						)
						.limit(1);

					if (!p) {
						throw new Error("Policy not found");
					}

					return p;
				}),
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Vacation policy not found",
							entityType: "vacation_policy",
							entityId: policyId,
						}),
				),
			);

			// Create new assignment
			yield* _(
				dbService.query("createAssignment", async () => {
					await dbService.db.insert(vacationPolicyAssignment).values({
						policyId,
						organizationId: actor.organizationId,
						assignmentType: "employee",
						employeeId,
						priority: 2, // Employee level = highest priority
						createdBy: actor.session.user.id,
					});
				}),
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create policy assignment",
							operation: "insert",
							table: "vacation_policy_assignment",
							cause: error,
						}),
				),
			);
		}
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a vacation policy assignment (soft delete)
 */
export async function deleteVacationPolicyAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteVacationPolicyAssignment:actor" }),
		);
		const dbService = yield* _(DatabaseService);

		// Step 5: Verify assignment belongs to the same organization
		const existingAssignment = yield* _(
			dbService.query("verifyAssignment", async () => {
				const [a] = await dbService.db
					.select()
					.from(vacationPolicyAssignment)
					.where(
						and(
							eq(vacationPolicyAssignment.id, assignmentId),
							eq(vacationPolicyAssignment.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!a) {
					throw new Error("Assignment not found");
				}

				return a;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Vacation policy assignment not found",
						entityType: "vacation_policy_assignment",
						entityId: assignmentId,
					}),
			),
		);

		yield* _(
			requireSettingsActorEmployeeAssignmentAccess(actor, existingAssignment.assignmentType, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "delete",
			}),
		);

		if (existingAssignment.employeeId) {
			const targetEmployee = yield* _(
				getTargetEmployee(existingAssignment.employeeId, "deleteVacationPolicyAssignment:getTargetEmployee"),
			);
			yield* _(
				ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "Insufficient permissions",
					resource: "vacation_policy_assignment",
					action: "delete",
				}),
			);
		}

		// Step 6: Soft delete
		yield* _(
			dbService.query("deleteVacationPolicyAssignment", async () => {
				await dbService.db
					.update(vacationPolicyAssignment)
					.set({ isActive: false })
					.where(eq(vacationPolicyAssignment.id, assignmentId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete vacation policy assignment",
						operation: "update",
						table: "vacation_policy_assignment",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get company default policies (current and next scheduled)
 * Returns policies marked as isCompanyDefault=true, grouped by current/next
 */
export async function getCompanyDefaultPolicies(organizationId: string): Promise<
	ServerActionResult<{
		current: any | null;
		next: any | null;
	}>
> {
	const effect = Effect.gen(function* (_) {
		yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getCompanyDefaultPolicies:actor" }),
		);
		const dbService = yield* _(DatabaseService);

		const today = new Date().toISOString().split("T")[0];

		// Get all company default policies
		const policies = yield* _(
			dbService.query("getCompanyDefaultPolicies", async () => {
				return await dbService.db
					.select({
						id: vacationAllowance.id,
						name: vacationAllowance.name,
						startDate: vacationAllowance.startDate,
						validUntil: vacationAllowance.validUntil,
						isCompanyDefault: vacationAllowance.isCompanyDefault,
						isActive: vacationAllowance.isActive,
						defaultAnnualDays: vacationAllowance.defaultAnnualDays,
						accrualType: vacationAllowance.accrualType,
						allowCarryover: vacationAllowance.allowCarryover,
						maxCarryoverDays: vacationAllowance.maxCarryoverDays,
					})
					.from(vacationAllowance)
					.where(
						and(
							eq(vacationAllowance.organizationId, organizationId),
							eq(vacationAllowance.isCompanyDefault, true),
							eq(vacationAllowance.isActive, true),
						),
					)
					.orderBy(vacationAllowance.startDate);
			}),
		);

		// Find current policy (startDate <= today AND (validUntil IS NULL OR validUntil >= today))
		const currentPolicy = policies.find((p) => {
			const isStarted = p.startDate <= today;
			const isNotExpired = !p.validUntil || p.validUntil >= today;
			return isStarted && isNotExpired;
		});

		// Find next scheduled policy (startDate > today AND validUntil IS NULL)
		const nextPolicy = policies.find((p) => {
			return p.startDate > today && !p.validUntil;
		});

		return {
			current: currentPolicy || null,
			next: nextPolicy || null,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
