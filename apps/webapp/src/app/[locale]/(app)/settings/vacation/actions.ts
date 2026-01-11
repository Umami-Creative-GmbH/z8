"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, employeeVacationAllowance, vacationAllowance } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isManagerOf } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

/**
 * Get current employee from session
 */
async function _getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
		with: {
			user: {
				with: {
					members: true,
				},
			},
		},
	});

	return emp;
}

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
 * Get vacation policy for an organization and year using Effect pattern
 */
export async function getVacationPolicy(
	organizationId: string,
	year: number,
): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect | null>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get current employee
		const dbService = yield* _(DatabaseService);
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

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

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policy",
						action: "read",
					}),
				),
			);
		}

		// Step 4: Get vacation policy
		const policy = yield* _(
			dbService.query("getVacationPolicy", async () => {
				return await dbService.db.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.organizationId, organizationId),
						eq(vacationAllowance.year, year),
					),
					with: {
						creator: true,
					},
				});
			}),
		);

		return policy || null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create vacation policy for an organization using Effect pattern
 */
export async function createVacationPolicy(data: {
	organizationId: string;
	name: string;
	year: number;
	defaultAnnualDays: string;
	accrualType: "annual" | "monthly" | "biweekly";
	accrualStartMonth?: number;
	allowCarryover: boolean;
	maxCarryoverDays?: string;
	carryoverExpiryMonths?: number;
}): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get current employee
		const dbService = yield* _(DatabaseService);
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

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

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, data.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policy",
						action: "create",
					}),
				),
			);
		}

		// Step 4: Check if policy with same name already exists for this year
		const existingWithName = yield* _(
			dbService.query("checkExistingPolicyName", async () => {
				return await dbService.db.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.organizationId, data.organizationId),
						eq(vacationAllowance.year, data.year),
						eq(vacationAllowance.name, data.name),
					),
				});
			}),
		);

		if (existingWithName) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "A policy with this name already exists for this year",
						conflictType: "duplicate_policy_name",
						details: { year: data.year, name: data.name },
					}),
				),
			);
		}

		// Step 5: Create vacation policy
		const [policy] = yield* _(
			dbService.query("createVacationPolicy", async () => {
				return await dbService.db
					.insert(vacationAllowance)
					.values({
						organizationId: data.organizationId,
						name: data.name,
						year: data.year,
						defaultAnnualDays: data.defaultAnnualDays,
						accrualType: data.accrualType,
						accrualStartMonth: data.accrualStartMonth,
						allowCarryover: data.allowCarryover,
						maxCarryoverDays: data.maxCarryoverDays,
						carryoverExpiryMonths: data.carryoverExpiryMonths,
						createdBy: session.user.id,
					})
					.returning();
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create vacation policy",
						operation: "insert",
						table: "vacation_allowance",
						cause: error,
					}),
			),
		);

		return policy;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update vacation policy using Effect pattern
 */
export async function updateVacationPolicy(
	policyId: string,
	data: {
		name: string;
		defaultAnnualDays: string;
		accrualType: "annual" | "monthly" | "biweekly";
		accrualStartMonth?: number;
		allowCarryover: boolean;
		maxCarryoverDays?: string;
		carryoverExpiryMonths?: number;
	},
): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get the policy to check permissions
		const policy = yield* _(
			dbService.query("getPolicy", async () => {
				const p = await dbService.db.query.vacationAllowance.findFirst({
					where: eq(vacationAllowance.id, policyId),
				});

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Policy not found",
						entityType: "vacation_policy",
						entityId: policyId,
					}),
			),
		);

		// Step 4: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, policy.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policy",
						action: "update",
					}),
				),
			);
		}

		// Step 5: Update vacation policy
		const [updated] = yield* _(
			dbService.query("updateVacationPolicy", async () => {
				return await dbService.db
					.update(vacationAllowance)
					.set({
						name: data.name,
						defaultAnnualDays: data.defaultAnnualDays,
						accrualType: data.accrualType,
						accrualStartMonth: data.accrualStartMonth,
						allowCarryover: data.allowCarryover,
						maxCarryoverDays: data.maxCarryoverDays,
						carryoverExpiryMonths: data.carryoverExpiryMonths,
					})
					.where(eq(vacationAllowance.id, policyId))
					.returning();
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to update vacation policy",
						operation: "update",
						table: "vacation_allowance",
						cause: error,
					}),
			),
		);

		return updated;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all employees with their vacation allowances using Effect pattern
 */
export async function getEmployeesWithAllowances(
	organizationId: string,
	year: number,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "employee_allowances",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get employees with allowances
		const dbService = yield* _(DatabaseService);
		const employees = yield* _(
			dbService.query("getEmployeesWithAllowances", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					with: {
						user: true,
						team: true,
						vacationAllowances: {
							where: eq(employeeVacationAllowance.year, year),
						},
					},
				});
			}),
		);

		return employees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get employee vacation allowance for a specific year using Effect pattern
 */
export async function getEmployeeAllowance(
	employeeId: string,
	year: number,
): Promise<ServerActionResult<any | null>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee
		const emp = yield* _(
			dbService.query("getEmployee", async () => {
				const e = await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
					with: {
						user: true,
						team: true,
						vacationAllowances: {
							where: eq(employeeVacationAllowance.year, year),
						},
					},
				});

				if (!e) {
					throw new Error("Employee not found");
				}

				return e;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
			),
		);

		// Step 4: Get current employee for permission check
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const curr = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!curr) {
					throw new Error("Current employee not found");
				}

				return curr;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Step 5: Verify user is org admin or manager of this employee
		const isAdmin = yield* _(Effect.promise(() => isOrgAdmin(session.user.id, emp.organizationId)));
		const isManager = yield* _(Effect.promise(() => isManagerOf(emp.id)));

		if (!isAdmin && !isManager && currentEmployee.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "employee_allowance",
						action: "read",
					}),
				),
			);
		}

		return emp;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update employee vacation allowance using Effect pattern
 */
export async function updateEmployeeAllowance(
	employeeId: string,
	year: number,
	data: {
		customAnnualDays?: string;
		customCarryoverDays?: string;
		adjustmentDays?: string;
		adjustmentReason?: string;
	},
): Promise<ServerActionResult<typeof employeeVacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const curr = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!curr) {
					throw new Error("Employee not found");
				}

				return curr;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Step 4: Get target employee
		const emp = yield* _(
			dbService.query("getTargetEmployee", async () => {
				const e = await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
				});

				if (!e) {
					throw new Error("Employee not found");
				}

				return e;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
			),
		);

		// Step 5: Verify user is org admin or manager of this employee
		const isAdmin = yield* _(Effect.promise(() => isOrgAdmin(session.user.id, emp.organizationId)));
		const isManager = yield* _(Effect.promise(() => isManagerOf(emp.id)));

		if (!isAdmin && !isManager && currentEmployee.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "employee_allowance",
						action: "update",
					}),
				),
			);
		}

		// Step 6: Check if allowance exists
		const existing = yield* _(
			dbService.query("checkExistingAllowance", async () => {
				return await dbService.db.query.employeeVacationAllowance.findFirst({
					where: and(
						eq(employeeVacationAllowance.employeeId, employeeId),
						eq(employeeVacationAllowance.year, year),
					),
				});
			}),
		);

		// Step 7: Update or create allowance
		const allowance = yield* _(
			dbService.query("upsertEmployeeAllowance", async () => {
				if (existing) {
					// Update existing
					const [updated] = await dbService.db
						.update(employeeVacationAllowance)
						.set({
							customAnnualDays: data.customAnnualDays,
							customCarryoverDays: data.customCarryoverDays,
							adjustmentDays: data.adjustmentDays,
							adjustmentReason: data.adjustmentReason,
							adjustedAt: data.adjustmentReason ? currentTimestamp() : existing.adjustedAt,
							adjustedBy: data.adjustmentReason ? currentEmployee.id : existing.adjustedBy,
						})
						.where(eq(employeeVacationAllowance.id, existing.id))
						.returning();
					return updated;
				}

				// Create new
				const [created] = await dbService.db
					.insert(employeeVacationAllowance)
					.values({
						employeeId,
						year,
						customAnnualDays: data.customAnnualDays,
						customCarryoverDays: data.customCarryoverDays,
						adjustmentDays: data.adjustmentDays || "0",
						adjustmentReason: data.adjustmentReason,
						adjustedAt: data.adjustmentReason ? currentTimestamp() : null,
						adjustedBy: data.adjustmentReason ? currentEmployee.id : null,
					})
					.returning();
				return created;
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to update employee allowance",
						operation: existing ? "update" : "insert",
						table: "employee_vacation_allowance",
						cause: error,
					}),
			),
		);

		return allowance;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get adjustment history for an organization using Effect pattern
 */
export async function getAdjustmentHistory(
	organizationId: string,
	year: number,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "adjustment_history",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get adjustment history
		const dbService = yield* _(DatabaseService);
		const adjustments = yield* _(
			dbService.query("getAdjustmentHistory", async () => {
				return await dbService.db.query.employeeVacationAllowance.findMany({
					where: eq(employeeVacationAllowance.year, year),
					with: {
						employee: {
							with: {
								user: true,
								team: true,
							},
						},
						adjuster: {
							with: {
								user: true,
							},
						},
					},
					orderBy: desc(employeeVacationAllowance.adjustedAt),
				});
			}),
		);

		// Filter to only this organization and only records with adjustments
		const filtered = adjustments.filter(
			(adj) =>
				adj.employee.organizationId === organizationId && adj.adjustmentReason && adj.adjustedAt,
		);

		return filtered;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all vacation policies for an organization, optionally filtered by year
 */
export async function getVacationPolicies(
	organizationId: string,
	year?: number,
): Promise<ServerActionResult<(typeof vacationAllowance.$inferSelect)[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policies",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get vacation policies, optionally filtered by year
		const dbService = yield* _(DatabaseService);
		const policies = yield* _(
			dbService.query("getVacationPolicies", async () => {
				const whereConditions = year
					? and(
							eq(vacationAllowance.organizationId, organizationId),
							eq(vacationAllowance.year, year),
						)
					: eq(vacationAllowance.organizationId, organizationId);

				return await dbService.db.query.vacationAllowance.findMany({
					where: whereConditions,
					with: {
						creator: true,
					},
					orderBy: (table, { desc: descOrder, asc }) => [descOrder(table.year), asc(table.name)],
				});
			}),
		);

		return policies;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get available years for vacation policies in an organization
 */
export async function getVacationPolicyYears(
	organizationId: string,
): Promise<ServerActionResult<number[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policies",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get distinct years
		const dbService = yield* _(DatabaseService);
		const years = yield* _(
			dbService.query("getVacationPolicyYears", async () => {
				const results = await dbService.db
					.selectDistinct({ year: vacationAllowance.year })
					.from(vacationAllowance)
					.where(eq(vacationAllowance.organizationId, organizationId))
					.orderBy(desc(vacationAllowance.year));

				return results.map((r) => r.year);
			}),
		);

		return years;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a vacation policy using Effect pattern
 */
export async function deleteVacationPolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get the policy to check permissions
		const policy = yield* _(
			dbService.query("getPolicy", async () => {
				const p = await dbService.db.query.vacationAllowance.findFirst({
					where: eq(vacationAllowance.id, policyId),
				});

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Policy not found",
						entityType: "vacation_policy",
						entityId: policyId,
					}),
			),
		);

		// Step 4: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, policy.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "vacation_policy",
						action: "delete",
					}),
				),
			);
		}

		// Step 5: Delete the policy (cascade will remove assignments)
		yield* _(
			dbService.query("deleteVacationPolicy", async () => {
				await dbService.db.delete(vacationAllowance).where(eq(vacationAllowance.id, policyId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete vacation policy",
						operation: "delete",
						table: "vacation_allowance",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
