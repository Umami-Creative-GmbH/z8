"use server";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, team, vacationAllowance, vacationPolicyAssignment } from "@/db/schema";
import {
	endVacationPolicyAssignment,
	loadVacationPolicyHistoryContext,
	type VacationAssignmentDates,
	VacationPolicyConfigurationError,
	writeVacationPolicyAssignment,
} from "@/lib/absences/vacation-policy-assignment-write";
import {
	loadEmployeeVacationPolicy,
	type VacationPolicyResolution,
} from "@/lib/absences/vacation-policy-history";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
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
	const effect = Effect.gen(function* () {
		yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getVacationPoliciesForAssignment:actor",
		});
		const dbService = yield* DatabaseService;

		// Step 3: Get policies from database
		const policies = yield* dbService
			.query("getVacationPolicies", async () => {
				return await dbService.db
					.select()
					.from(vacationAllowance)
					.where(eq(vacationAllowance.organizationId, organizationId))
					.orderBy(vacationAllowance.startDate);
			})
			.pipe(
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
	});

	return runServerActionSafe(effect);
}

/**
 * Get all vacation policy assignments for an organization
 */
export async function getVacationPolicyAssignments(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getVacationPolicyAssignments:actor",
		});
		const dbService = yield* DatabaseService;
		const managedEmployeeIds = yield* getManagedEmployeeIdsForSettingsActor(actor);

		// Step 3: Get assignments from database with policy, team, and employee info
		const assignments = yield* dbService
			.query("getVacationPolicyAssignments", async () => {
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
						effectiveStartDate: vacationPolicyAssignment.effectiveStartDate,
						effectiveEndDate: vacationPolicyAssignment.effectiveEndDate,
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
							firstName: user.firstName,
							lastName: user.lastName,
						},
					})
					.from(vacationPolicyAssignment)
					.innerJoin(
						vacationAllowance,
						and(
							eq(vacationPolicyAssignment.policyId, vacationAllowance.id),
							eq(vacationAllowance.organizationId, organizationId),
						),
					)
					.leftJoin(
						team,
						and(
							eq(vacationPolicyAssignment.teamId, team.id),
							eq(team.organizationId, organizationId),
						),
					)
					.leftJoin(
						employee,
						and(
							eq(vacationPolicyAssignment.employeeId, employee.id),
							eq(employee.organizationId, organizationId),
						),
					)
					.leftJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(vacationPolicyAssignment.organizationId, organizationId),
							eq(vacationPolicyAssignment.isActive, true),
						),
					)
					.orderBy(vacationAllowance.startDate);
			})
			.pipe(
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
		const normalizedAssignments = assignments.map((assignment) => {
			const assignmentEmployee = assignment.employee?.id
				? { ...assignment.employee, id: assignment.employee.id }
				: null;

			return {
				...assignment,
				employee: assignmentEmployee,
			};
		});

		if (!managedEmployeeIds) {
			return normalizedAssignments;
		}

		return filterItemsToManagedEmployees(
			normalizedAssignments.filter((assignment) => assignment.assignmentType === "employee"),
			managedEmployeeIds,
		);
	});

	return runServerActionSafe(effect);
}

/**
 * Create a vacation policy assignment
 */
export async function createVacationPolicyAssignment(
	data: VacationAssignmentDates & {
		policyId: string;
		assignmentType: "organization" | "team" | "employee";
		teamId?: string;
		employeeId?: string;
	},
): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const policy = yield* dbService
			.query("verifyPolicy", async () => {
				const [p] = await dbService.db
					.select()
					.from(vacationAllowance)
					.where(eq(vacationAllowance.id, data.policyId))
					.limit(1);

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Vacation policy not found",
							entityType: "vacation_policy",
							entityId: data.policyId,
						}),
				),
			);
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId: policy.organizationId,
			queryName: "createVacationPolicyAssignment:actor",
		});
		yield* requireSettingsActorEmployeeAssignmentAccess(actor, data.assignmentType, {
			message: "Insufficient permissions",
			resource: "vacation_policy_assignment",
			action: "create",
		});
		yield* validateAssignmentTargetFields(data.assignmentType, data);

		if (data.assignmentType !== "employee" || data.reviewedBackdate) {
			yield* requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "create",
			});
		}

		if (data.employeeId) {
			const targetEmployee = yield* getTargetEmployee(
				data.employeeId,
				"createVacationPolicyAssignment:getTargetEmployee",
			);
			yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "create",
			});
		}

		if (data.assignmentType === "team" && data.teamId) {
			yield* getOrganizationTeam(
				data.teamId,
				actor.organizationId,
				"createVacationPolicyAssignment:getOrganizationTeam",
			);
		}

		// Step 7: Create the assignment
		const newAssignment = yield* dbService
			.query("createVacationPolicyAssignment", async () => {
				return writeVacationPolicyAssignment(dbService.db, {
					...data,
					organizationId: actor.organizationId,
					createdBy: actor.session.user.id,
				});
			})
			.pipe(Effect.mapError(vacationConfigurationFailure));

		return newAssignment;
	});

	return runServerActionSafe(effect);
}

/**
 * Get a specific employee's direct policy assignment (if any)
 */
export async function getEmployeePolicyAssignment(
	employeeId: string,
): Promise<ServerActionResult<any | null>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "getEmployeePolicyAssignment:actor",
		});
		const targetEmployee = yield* getTargetEmployee(
			employeeId,
			"getEmployeePolicyAssignment:getTargetEmployee",
		);
		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "Insufficient permissions",
			resource: "vacation_policy_assignment",
			action: "read",
		});
		const dbService = yield* DatabaseService;

		const { today } = yield* dbService.query("vacation.date", () =>
			loadVacationPolicyHistoryContext(dbService.db, actor.organizationId),
		);
		const assignment = yield* dbService.query("getEmployeePolicyAssignment", async () => {
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
				.innerJoin(
					vacationAllowance,
					and(
						eq(vacationPolicyAssignment.policyId, vacationAllowance.id),
						eq(vacationAllowance.organizationId, actor.organizationId),
					),
				)
				.where(
					and(
						eq(vacationPolicyAssignment.employeeId, employeeId),
						eq(vacationPolicyAssignment.organizationId, actor.organizationId),
						lte(vacationPolicyAssignment.effectiveStartDate, today),
						or(
							isNull(vacationPolicyAssignment.effectiveEndDate),
							gt(vacationPolicyAssignment.effectiveEndDate, today),
						),
						eq(vacationPolicyAssignment.assignmentType, "employee"),
						eq(vacationPolicyAssignment.isActive, true),
					),
				)
				.limit(1);

			return result || null;
		});

		return assignment;
	});

	return runServerActionSafe(effect);
}

/**
 * Set or clear an employee's direct policy assignment
 */
export async function setEmployeePolicyAssignment(
	employeeId: string,
	policyId: string | null,
	options: VacationAssignmentDates = {},
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "setEmployeePolicyAssignment:actor",
		});
		const targetEmployee = yield* getTargetEmployee(
			employeeId,
			"setEmployeePolicyAssignment:getTargetEmployee",
		);
		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
			message: "Insufficient permissions",
			resource: "vacation_policy_assignment",
			action: "update",
		});
		if (options.reviewedBackdate)
			yield* requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin review is required for backdating",
				resource: "vacation_policy_assignment",
				action: "update",
			});
		const dbService = yield* DatabaseService;
		yield* dbService
			.query("vacation.employeeAssignment", () =>
				writeVacationPolicyAssignment(dbService.db, {
					...options,
					organizationId: actor.organizationId,
					createdBy: actor.session.user.id,
					policyId,
					employeeId,
					assignmentType: "employee",
				}),
			)
			.pipe(Effect.mapError(vacationConfigurationFailure));
	});
	return runServerActionSafe(effect);
}
/**
 * Delete a vacation policy assignment (soft delete)
 */
export async function deleteVacationPolicyAssignment(
	assignmentId: string,
	effectiveOn?: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deleteVacationPolicyAssignment:actor",
		});
		const dbService = yield* DatabaseService;

		// Step 5: Verify assignment belongs to the same organization
		const existingAssignment = yield* dbService
			.query("verifyAssignment", async () => {
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
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Vacation policy assignment not found",
							entityType: "vacation_policy_assignment",
							entityId: assignmentId,
						}),
				),
			);

		yield* requireSettingsActorEmployeeAssignmentAccess(actor, existingAssignment.assignmentType, {
			message: "Insufficient permissions",
			resource: "vacation_policy_assignment",
			action: "delete",
		});

		if (existingAssignment.employeeId) {
			const targetEmployee = yield* getTargetEmployee(
				existingAssignment.employeeId,
				"deleteVacationPolicyAssignment:getTargetEmployee",
			);
			yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "delete",
			});
		}

		// Step 6: Soft delete
		yield* dbService
			.query("deleteVacationPolicyAssignment", async () => {
				await endVacationPolicyAssignment(dbService.db, {
					organizationId: actor.organizationId,
					assignmentId,
					effectiveOn,
				});
			})
			.pipe(Effect.mapError(vacationConfigurationFailure));
	});

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
	const effect = Effect.gen(function* () {
		yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getCompanyDefaultPolicies:actor",
		});
		const dbService = yield* DatabaseService;

		const { today } = yield* dbService.query("vacation.date", () =>
			loadVacationPolicyHistoryContext(dbService.db, organizationId),
		);

		// Get all company default policies
		const policies = yield* dbService.query("getCompanyDefaultPolicies", async () => {
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
		});

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
	});

	return runServerActionSafe(effect);
}

function vacationConfigurationFailure(error: DatabaseError) {
	let cause: unknown = error.cause;
	while (cause && typeof cause === "object" && "cause" in cause && cause.cause) cause = cause.cause;
	if (cause instanceof VacationPolicyConfigurationError)
		return new ValidationError({
			message: cause.message,
			field: "effectiveFrom",
		});
	if (
		cause &&
		typeof cause === "object" &&
		"message" in cause &&
		typeof cause.message === "string" &&
		cause.message.startsWith("Vacation ")
	)
		return new ValidationError({
			message: cause.message,
			field: "effectiveFrom",
		});
	return error;
}

export async function previewEmployeeVacationPolicy(
	employeeId: string,
	date: string,
): Promise<ServerActionResult<VacationPolicyResolution>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* getEmployeeSettingsActorContext({
				queryName: "previewEmployeeVacationPolicy:actor",
			});
			const target = yield* getTargetEmployee(employeeId, "previewEmployeeVacationPolicy:target");
			yield* ensureSettingsActorCanAccessEmployeeTarget(actor, target, {
				message: "Insufficient permissions",
				resource: "vacation_policy_assignment",
				action: "read",
			});
			const service = yield* DatabaseService;
			return yield* service.query("vacation.preview", () =>
				loadEmployeeVacationPolicy(service.db, {
					organizationId: actor.organizationId,
					employeeId,
					date,
				}),
			);
		}),
	);
}

export async function getVacationPolicyHistoryContext(organizationId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			yield* getEmployeeSettingsActorContext({
				organizationId,
				queryName: "vacationHistoryContext:actor",
			});
			const service = yield* DatabaseService;
			return yield* service.query("vacation.historyContext", () =>
				loadVacationPolicyHistoryContext(service.db, organizationId),
			);
		}),
	);
}
