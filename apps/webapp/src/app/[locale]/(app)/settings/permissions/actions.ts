"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { employee } from "@/db/schema";
import { type AnyAppError, AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EmployeePermissions,
	PermissionsService,
} from "@/lib/effect/services/permissions.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("PermissionsActions");

// =============================================================================
// Validation Schemas
// =============================================================================

const permissionFlagsSchema = z.object({
	canCreateTeams: z.boolean().optional(),
	canManageTeamMembers: z.boolean().optional(),
	canManageTeamSettings: z.boolean().optional(),
	canApproveTeamRequests: z.boolean().optional(),
});

const grantPermissionsSchema = z.object({
	employeeId: z.string().uuid("Invalid employee ID"),
	organizationId: z.string().min(1, "Organization ID is required"),
	permissions: permissionFlagsSchema,
	teamId: z.string().uuid("Invalid team ID").nullable().optional(),
});

type GrantPermissions = z.infer<typeof grantPermissionsSchema>;

// =============================================================================
// Permission Management Actions
// =============================================================================

/**
 * Grant team permissions to an employee
 * Requires admin role
 */
export async function grantTeamPermissions(
	data: GrantPermissions,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("permissions");

	const effect = tracer.startActiveSpan(
		"grantTeamPermissions",
		{
			attributes: {
				"employee.id": data.employeeId,
				"team.id": data.teamId || "organization-wide",
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

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
								message: "Only admins can grant permissions",
								userId: currentEmployee.id,
								resource: "team_permissions",
								action: "grant",
							}),
						),
					);
				}

				span.setAttribute("currentEmployee.id", currentEmployee.id);

				// Validate data
				const validationResult = grantPermissionsSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.errors?.[0]?.message || "Invalid input",
								field: validationResult.error?.errors?.[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Grant permissions using PermissionsService
				yield* _(
					permissionsService.grantPermissions(
						validatedData.employeeId,
						validatedData.organizationId,
						validatedData.permissions,
						validatedData.teamId || null,
						currentEmployee.id,
					),
				);

				logger.info(
					{
						employeeId: validatedData.employeeId,
						teamId: validatedData.teamId,
						permissions: validatedData.permissions,
					},
					"Permissions granted successfully",
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
						logger.error({ error, data }, "Failed to grant permissions");
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
 * Revoke team permissions from an employee
 * Requires admin role
 */
export async function revokeTeamPermissions(
	employeeId: string,
	organizationId: string,
	teamId?: string | null,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("permissions");

	const effect = tracer.startActiveSpan(
		"revokeTeamPermissions",
		{
			attributes: {
				"employee.id": employeeId,
				"team.id": teamId || "organization-wide",
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

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
								message: "Only admins can revoke permissions",
								userId: currentEmployee.id,
								resource: "team_permissions",
								action: "revoke",
							}),
						),
					);
				}

				span.setAttribute("currentEmployee.id", currentEmployee.id);

				// Revoke permissions using PermissionsService
				yield* _(permissionsService.revokePermissions(employeeId, organizationId, teamId || null));

				logger.info(
					{
						employeeId,
						teamId,
					},
					"Permissions revoked successfully",
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
						logger.error({ error, employeeId, teamId }, "Failed to revoke permissions");
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
 * Get employee permissions
 * Admins can view any employee's permissions
 * Employees can view their own permissions
 */
export async function getEmployeePermissions(
	employeeId: string,
): Promise<ServerActionResult<EmployeePermissions[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

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

		// Allow admins or self to view permissions
		if (currentEmployee.role !== "admin" && currentEmployee.id !== employeeId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot view permissions for other employees",
						userId: currentEmployee.id,
						resource: "team_permissions",
						action: "read",
					}),
				),
			);
		}

		// Get permissions using PermissionsService
		const permissions = yield* _(permissionsService.getEmployeePermissions(employeeId));

		return permissions;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Check if employee has a specific permission
 * Can be called by anyone to check their own or others' permissions
 */
export async function hasTeamPermission(
	employeeId: string,
	permission:
		| "canCreateTeams"
		| "canManageTeamMembers"
		| "canManageTeamSettings"
		| "canApproveTeamRequests",
	teamId?: string | null,
): Promise<ServerActionResult<boolean>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

		// Get current employee (just to verify authentication)
		const _currentEmployee = yield* _(
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

		// Check permission using PermissionsService
		const hasPermission = yield* _(
			permissionsService.hasTeamPermission(employeeId, permission, teamId || null),
		);

		return hasPermission;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * List all employees with their permissions in an organization
 * Requires admin role
 */
export async function listEmployeePermissions(organizationId?: string): Promise<
	ServerActionResult<
		Array<{
			employee: typeof employee.$inferSelect;
			permissions: EmployeePermissions[];
		}>
	>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

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
						message: "Only admins can list all permissions",
						userId: currentEmployee.id,
						resource: "team_permissions",
						action: "list",
					}),
				),
			);
		}

		const targetOrgId = organizationId || currentEmployee.organizationId;

		// Get all employees in organization
		const employees = yield* _(
			dbService.query("listEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, targetOrgId),
					with: {
						user: true,
					},
					orderBy: (employee, { asc }) => [asc(employee.user.name)],
				});
			}),
		);

		// Get permissions for each employee
		const employeePermissions = yield* _(
			Effect.all(
				employees.map((emp) =>
					Effect.gen(function* (_) {
						const permissions = yield* _(permissionsService.getEmployeePermissions(emp.id));
						return {
							employee: emp,
							permissions,
						};
					}),
				),
			),
		);

		return employeePermissions;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
