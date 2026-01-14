"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { employee, type team } from "@/db/schema";

// Type for employee with user and team relations
export type EmployeeWithRelations = typeof employee.$inferSelect & {
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
};

// Pagination parameters
export interface EmployeeListParams {
	search?: string;
	role?: "admin" | "manager" | "employee" | "all";
	status?: "active" | "inactive" | "all";
	limit?: number;
	offset?: number;
}

// Paginated response
export interface PaginatedEmployeeResponse {
	employees: EmployeeWithRelations[];
	total: number;
	hasMore: boolean;
}

import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";
import {
	type AssignManagers,
	assignManagersSchema,
	type CreateEmployee,
	createEmployeeSchema,
	type PersonalInformation,
	personalInformationSchema,
	type UpdateEmployee,
	updateEmployeeSchema,
} from "@/lib/validations/employee";

const logger = createLogger("EmployeeActions");

// =============================================================================
// Employee CRUD Actions
// =============================================================================

/**
 * Create a new employee record
 * Requires admin role
 */
export async function createEmployee(
	data: CreateEmployee,
): Promise<ServerActionResult<typeof employee.$inferSelect>> {
	const tracer = trace.getTracer("employees");

	const effect = tracer.startActiveSpan(
		"createEmployee",
		{
			attributes: {
				"employee.organizationId": data.organizationId,
				"employee.role": data.role,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				// Step 1: Get authenticated user
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Step 2: Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, data.organizationId),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can create employee records",
								userId: currentEmployee.id,
								resource: "employee",
								action: "create",
							}),
						),
					);
				}

				span.setAttribute("currentEmployee.id", currentEmployee.id);

				// Step 3: Validate data
				const validationResult = createEmployeeSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.issues?.[0]?.message || "Invalid input",
								field: validationResult.error?.issues?.[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Step 4: Verify user exists
				const _targetUser = yield* _(
					dbService.query("getTargetUser", async () => {
						return await dbService.db.query.user.findFirst({
							where: eq(user.id, validatedData.userId),
						});
					}),
					Effect.flatMap((u) =>
						u
							? Effect.succeed(u)
							: Effect.fail(
									new NotFoundError({
										message: "User not found",
										entityType: "user",
										entityId: validatedData.userId,
									}),
								),
					),
				);

				// Step 5: Check if employee already exists
				const existing = yield* _(
					dbService.query("checkExistingEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, validatedData.userId),
								eq(employee.organizationId, validatedData.organizationId),
							),
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Employee already exists for this user in this organization",
								field: "userId",
								value: validatedData.userId,
							}),
						),
					);
				}

				// Step 6: Create employee record
				const [newEmployee] = yield* _(
					dbService.query("createEmployee", async () => {
						return await dbService.db
							.insert(employee)
							.values({
								userId: validatedData.userId,
								organizationId: validatedData.organizationId,
								teamId: validatedData.teamId || null,
								role: validatedData.role,
								position: validatedData.position || null,
								firstName: validatedData.firstName || null,
								lastName: validatedData.lastName || null,
								gender: validatedData.gender || null,
								birthday: validatedData.birthday || null,
								startDate: validatedData.startDate || null,
								endDate: validatedData.endDate || null,
								isActive: true,
							})
							.returning();
					}),
				);

				logger.info(
					{
						employeeId: newEmployee.id,
						userId: newEmployee.userId,
						organizationId: newEmployee.organizationId,
					},
					"Employee created successfully",
				);

				// Invalidate employees cache
				revalidateTag(CACHE_TAGS.EMPLOYEES(newEmployee.organizationId), "max");

				span.setAttribute("employee.id", newEmployee.id);
				span.setStatus({ code: SpanStatusCode.OK });
				return newEmployee;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to create employee");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update an employee record
 * Requires admin role
 */
export async function updateEmployee(
	employeeId: string,
	data: UpdateEmployee,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("employees");

	const effect = tracer.startActiveSpan(
		"updateEmployee",
		{
			attributes: {
				"employee.id": employeeId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				// Verify admin role
				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can update employee records",
								userId: currentEmployee.id,
								resource: "employee",
								action: "update",
							}),
						),
					);
				}

				// Validate data
				const validationResult = updateEmployeeSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.issues?.[0]?.message || "Invalid input",
								field: validationResult.error?.issues?.[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Update employee
				yield* _(
					dbService.query("updateEmployee", async () => {
						await dbService.db
							.update(employee)
							.set({
								...validatedData,
								updatedAt: currentTimestamp(),
							})
							.where(eq(employee.id, employeeId));
					}),
				);

				logger.info({ employeeId }, "Employee updated successfully");

				// Invalidate employees cache
				revalidateTag(CACHE_TAGS.EMPLOYEES(currentEmployee.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId }, "Failed to update employee");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update own profile (self-service)
 * Employees can update their own personal information
 */
export async function updateOwnProfile(
	data: PersonalInformation,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("employees");

	const effect = tracer.startActiveSpan("updateOwnProfile", (span) => {
		return Effect.gen(function* (_) {
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const dbService = yield* _(DatabaseService);

			// Get current employee
			const currentEmployee = yield* _(
				dbService.query("getCurrentEmployee", async () => {
					return await dbService.db.query.employee.findFirst({
						where: eq(employee.userId, session.user.id),
					});
				}),
				Effect.flatMap((emp) =>
					emp
						? Effect.succeed(emp)
						: Effect.fail(
								new NotFoundError({
									message: "Employee profile not found",
									entityType: "employee",
								}),
							),
				),
			);

			span.setAttribute("employee.id", currentEmployee.id);

			// Validate data
			const result = personalInformationSchema.safeParse(data);
			if (!result.success) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: result.error?.issues?.[0]?.message || "Invalid input",
							field: "profile",
						}),
					),
				);
			}

			const validatedData = result.data;

			// Update only personal information fields
			yield* _(
				dbService.query("updateOwnProfile", async () => {
					await dbService.db
						.update(employee)
						.set({
							firstName: validatedData.firstName,
							lastName: validatedData.lastName,
							gender: validatedData.gender,
							birthday: validatedData.birthday,
							updatedAt: currentTimestamp(),
						})
						.where(eq(employee.id, currentEmployee.id));
				}),
			);

			logger.info({ employeeId: currentEmployee.id }, "Profile updated successfully");

			span.setStatus({ code: SpanStatusCode.OK });
		}).pipe(
			Effect.catchAll((error) =>
				Effect.gen(function* (_) {
					span.recordException(error as Error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: String(error),
					});
					logger.error({ error }, "Failed to update own profile");
					return yield* _(Effect.fail(error as AnyAppError));
				}),
			),
			Effect.onExit(() => Effect.sync(() => span.end())),
			Effect.provide(AppLayer),
		);
	});

	return runServerActionSafe(effect);
}

/**
 * Get employee details with related data
 */
export async function getEmployee(
	employeeId: string,
): Promise<ServerActionResult<typeof employee.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		// Get target employee with relations
		const targetEmployee = yield* _(
			dbService.query("getTargetEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
					with: {
						user: true,
						team: true,
						managers: {
							with: {
								manager: {
									with: {
										user: true,
									},
								},
							},
						},
						workScheduleAssignments: {
							with: {
								template: {
									with: {
										days: true,
									},
								},
							},
							orderBy: (schedule, { desc }) => [desc(schedule.effectiveFrom)],
							limit: 1,
						},
					},
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
								entityId: employeeId,
							}),
						),
			),
		);

		// Verify same organization
		if (targetEmployee.organizationId !== currentEmployee.organizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access employee from different organization",
						userId: currentEmployee.id,
						resource: "employee",
						action: "read",
					}),
				),
			);
		}

		return targetEmployee;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * List employees with server-side pagination, search, and filters
 */
export async function listEmployees(
	params: EmployeeListParams = {},
): Promise<ServerActionResult<PaginatedEmployeeResponse>> {
	const { search, role, status, limit = 20, offset = 0 } = params;

	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		const orgId = currentEmployee.organizationId;

		// Build base conditions
		const conditions: ReturnType<typeof eq>[] = [eq(employee.organizationId, orgId)];

		// Role filter
		if (role && role !== "all") {
			conditions.push(eq(employee.role, role));
		}

		// Status filter
		if (status && status !== "all") {
			conditions.push(eq(employee.isActive, status === "active"));
		}

		// Get employees with pagination
		const employees = yield* _(
			dbService.query("listEmployees", async () => {
				// Build the query with search
				let results = await dbService.db.query.employee.findMany({
					where: and(...conditions),
					with: {
						user: true,
						team: true,
					},
					orderBy: (emp, { asc }) => [asc(emp.firstName), asc(emp.lastName)],
				});

				// Apply search filter (server-side but after fetch due to relation access)
				if (search) {
					const searchLower = search.toLowerCase();
					results = results.filter(
						(emp) =>
							emp.user?.name?.toLowerCase().includes(searchLower) ||
							emp.user?.email?.toLowerCase().includes(searchLower) ||
							emp.firstName?.toLowerCase().includes(searchLower) ||
							emp.lastName?.toLowerCase().includes(searchLower) ||
							emp.position?.toLowerCase().includes(searchLower),
					);
				}

				// Sort by user name
				results.sort((a, b) => {
					const nameA = a.user?.name || `${a.firstName || ""} ${a.lastName || ""}`.trim() || "";
					const nameB = b.user?.name || `${b.firstName || ""} ${b.lastName || ""}`.trim() || "";
					return nameA.localeCompare(nameB);
				});

				return results;
			}),
		);

		// Calculate pagination
		const total = employees.length;
		const paginatedEmployees = employees.slice(offset, offset + limit + 1);
		const hasMore = paginatedEmployees.length > limit;
		const resultEmployees = hasMore ? paginatedEmployees.slice(0, limit) : paginatedEmployees;

		return {
			employees: resultEmployees as EmployeeWithRelations[],
			total,
			hasMore,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// =============================================================================
// Manager Assignment Actions
// =============================================================================

/**
 * Assign managers to an employee
 * Requires admin role
 */
export async function assignManagers(
	employeeId: string,
	data: AssignManagers,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("employees");

	const effect = tracer.startActiveSpan(
		"assignManagers",
		{
			attributes: {
				"employee.id": employeeId,
				"managers.count": data.managers.length,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const managerService = yield* _(ManagerService);

				// Get current employee and verify admin role
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				if (currentEmployee.role !== "admin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins can assign managers",
								userId: currentEmployee.id,
								resource: "manager_assignment",
								action: "create",
							}),
						),
					);
				}

				// Validate data
				const validationResult = assignManagersSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.issues?.[0]?.message || "Invalid input",
								field: validationResult.error?.issues?.[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Remove existing managers
				const existingManagers = yield* _(managerService.getManagers(employeeId));

				for (const existingManager of existingManagers) {
					// Skip if this manager is in the new list
					if (validatedData.managers.some((m) => m.managerId === existingManager.id)) {
						continue;
					}

					// Only remove if not the last manager
					if (existingManagers.length > 1) {
						yield* _(managerService.removeManager(employeeId, existingManager.id));
					}
				}

				// Assign new managers
				for (const assignment of validatedData.managers) {
					yield* _(
						managerService.assignManager(
							employeeId,
							assignment.managerId,
							assignment.isPrimary,
							currentEmployee.id,
						),
					);
				}

				logger.info(
					{
						employeeId,
						managerCount: validatedData.managers.length,
					},
					"Managers assigned successfully",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, employeeId }, "Failed to assign managers");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// NOTE: Work schedule management is handled in settings/work-schedules/assignment-actions.ts
// Use createWorkScheduleAssignment from that file to assign schedules to employees
