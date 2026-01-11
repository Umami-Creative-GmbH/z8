"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { employee, holiday, holidayAssignment, holidayCategory, team } from "@/db/schema";
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
 * Get all holidays for an organization using Effect pattern
 */
export async function getHolidays(organizationId: string): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		// Step 2: Get holidays from database
		const dbService = yield* _(DatabaseService);
		const holidays = yield* _(
			dbService.query("getHolidays", async () => {
				return await dbService.db
					.select({
						id: holiday.id,
						name: holiday.name,
						description: holiday.description,
						startDate: holiday.startDate,
						endDate: holiday.endDate,
						recurrenceType: holiday.recurrenceType,
						recurrenceRule: holiday.recurrenceRule,
						recurrenceEndDate: holiday.recurrenceEndDate,
						isActive: holiday.isActive,
						categoryId: holiday.categoryId,
						category: {
							id: holidayCategory.id,
							name: holidayCategory.name,
							type: holidayCategory.type,
							color: holidayCategory.color,
						},
					})
					.from(holiday)
					.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
					.where(and(eq(holiday.organizationId, organizationId), eq(holiday.isActive, true)))
					.orderBy(holiday.startDate);
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holidays",
						operation: "select",
						table: "holiday",
						cause: error,
					}),
			),
		);

		return holidays;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get all holiday categories for an organization using Effect pattern
 */
export async function getHolidayCategories(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		// Step 2: Get categories from database
		const dbService = yield* _(DatabaseService);
		const categories = yield* _(
			dbService.query("getHolidayCategories", async () => {
				return await dbService.db
					.select()
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.organizationId, organizationId),
							eq(holidayCategory.isActive, true),
						),
					)
					.orderBy(holidayCategory.name);
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday categories",
						operation: "select",
						table: "holiday_category",
						cause: error,
					}),
			),
		);

		return categories;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a holiday (soft delete by setting isActive = false) using Effect pattern
 */
export async function deleteHoliday(holidayId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee record to check role and organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

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

		// Step 4: Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday",
						action: "delete",
					}),
				),
			);
		}

		// Step 5: Verify holiday belongs to the same organization
		const _existingHoliday = yield* _(
			dbService.query("verifyHoliday", async () => {
				const [h] = await dbService.db
					.select()
					.from(holiday)
					.where(
						and(
							eq(holiday.id, holidayId),
							eq(holiday.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!h) {
					throw new Error("Holiday not found");
				}

				return h;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: holidayId,
					}),
			),
		);

		// Step 6: Soft delete
		yield* _(
			dbService.query("deleteHoliday", async () => {
				await dbService.db
					.update(holiday)
					.set({ isActive: false, updatedBy: session.user.id })
					.where(eq(holiday.id, holidayId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday",
						operation: "update",
						table: "holiday",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Bulk delete holidays (soft delete by setting isActive = false) using Effect pattern
 */
export async function bulkDeleteHolidays(
	holidayIds: string[],
): Promise<ServerActionResult<{ deleted: number }>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee record to check role and organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

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

		// Step 4: Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday",
						action: "bulk_delete",
					}),
				),
			);
		}

		// Step 5: Bulk soft delete (only holidays belonging to this organization)
		const result = yield* _(
			dbService.query("bulkDeleteHolidays", async () => {
				const updateResult = await dbService.db
					.update(holiday)
					.set({ isActive: false, updatedBy: session.user.id })
					.where(
						and(
							inArray(holiday.id, holidayIds),
							eq(holiday.organizationId, employeeRecord.organizationId),
						),
					)
					.returning({ id: holiday.id });

				return { deleted: updateResult.length };
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to bulk delete holidays",
						operation: "update",
						table: "holiday",
						cause: error,
					}),
			),
		);

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a category (soft delete, but check if any holidays use it first) using Effect pattern
 */
export async function deleteCategory(categoryId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee record to check role and organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

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

		// Step 4: Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_category",
						action: "delete",
					}),
				),
			);
		}

		// Step 5: Verify category belongs to the same organization
		const _existingCategory = yield* _(
			dbService.query("verifyCategory", async () => {
				const [cat] = await dbService.db
					.select()
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, categoryId),
							eq(holidayCategory.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!cat) {
					throw new Error("Category not found");
				}

				return cat;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Category not found",
						entityType: "holiday_category",
						entityId: categoryId,
					}),
			),
		);

		// Step 6: Check if any active holidays use this category
		const holidaysUsingCategory = yield* _(
			dbService.query("checkHolidaysUsingCategory", async () => {
				return await dbService.db
					.select()
					.from(holiday)
					.where(and(eq(holiday.categoryId, categoryId), eq(holiday.isActive, true)))
					.limit(1);
			}),
		);

		if (holidaysUsingCategory.length > 0) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "Cannot delete category - it is being used by active holidays",
						conflictType: "category_in_use",
						details: { categoryId, holidayCount: holidaysUsingCategory.length },
					}),
				),
			);
		}

		// Step 7: Soft delete
		yield* _(
			dbService.query("deleteCategory", async () => {
				await dbService.db
					.update(holidayCategory)
					.set({ isActive: false })
					.where(eq(holidayCategory.id, categoryId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete category",
						operation: "update",
						table: "holiday_category",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// HOLIDAY ASSIGNMENTS (Custom holidays to org/team/employee)
// ============================================

/**
 * Get all holiday assignments for an organization
 */
export async function getHolidayAssignments(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get assignments from database with holiday, team, and employee info
		const assignments = yield* _(
			dbService.query("getHolidayAssignments", async () => {
				return await dbService.db
					.select({
						id: holidayAssignment.id,
						holidayId: holidayAssignment.holidayId,
						organizationId: holidayAssignment.organizationId,
						assignmentType: holidayAssignment.assignmentType,
						teamId: holidayAssignment.teamId,
						employeeId: holidayAssignment.employeeId,
						isActive: holidayAssignment.isActive,
						createdAt: holidayAssignment.createdAt,
						holiday: {
							id: holiday.id,
							name: holiday.name,
							description: holiday.description,
							startDate: holiday.startDate,
							endDate: holiday.endDate,
							recurrenceType: holiday.recurrenceType,
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
					.from(holidayAssignment)
					.innerJoin(holiday, eq(holidayAssignment.holidayId, holiday.id))
					.leftJoin(team, eq(holidayAssignment.teamId, team.id))
					.leftJoin(employee, eq(holidayAssignment.employeeId, employee.id))
					.where(
						and(
							eq(holidayAssignment.organizationId, organizationId),
							eq(holidayAssignment.isActive, true),
						),
					)
					.orderBy(holiday.name);
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday assignments",
						operation: "select",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);

		return assignments;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a holiday assignment
 */
export async function createHolidayAssignment(data: {
	holidayId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
}): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee record to check role and organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

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

		// Step 4: Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_assignment",
						action: "create",
					}),
				),
			);
		}

		// Step 5: Verify holiday belongs to the same organization
		const _existingHoliday = yield* _(
			dbService.query("verifyHoliday", async () => {
				const [h] = await dbService.db
					.select()
					.from(holiday)
					.where(
						and(
							eq(holiday.id, data.holidayId),
							eq(holiday.organizationId, employeeRecord.organizationId),
							eq(holiday.isActive, true),
						),
					)
					.limit(1);

				if (!h) {
					throw new Error("Holiday not found");
				}

				return h;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: data.holidayId,
					}),
			),
		);

		// Step 6: Create the assignment
		const newAssignment = yield* _(
			dbService.query("createHolidayAssignment", async () => {
				const [assignment] = await dbService.db
					.insert(holidayAssignment)
					.values({
						holidayId: data.holidayId,
						organizationId: employeeRecord.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId || null,
						employeeId: data.employeeId || null,
						createdBy: session.user.id,
					})
					.returning();

				return assignment;
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday assignment",
						operation: "insert",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);

		return newAssignment;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a holiday assignment (soft delete)
 */
export async function deleteHolidayAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get database service
		const dbService = yield* _(DatabaseService);

		// Step 3: Get employee record to check role and organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

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

		// Step 4: Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Step 5: Verify assignment belongs to the same organization
		const _existingAssignment = yield* _(
			dbService.query("verifyAssignment", async () => {
				const [a] = await dbService.db
					.select()
					.from(holidayAssignment)
					.where(
						and(
							eq(holidayAssignment.id, assignmentId),
							eq(holidayAssignment.organizationId, employeeRecord.organizationId),
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
						message: "Holiday assignment not found",
						entityType: "holiday_assignment",
						entityId: assignmentId,
					}),
			),
		);

		// Step 6: Soft delete
		yield* _(
			dbService.query("deleteHolidayAssignment", async () => {
				await dbService.db
					.update(holidayAssignment)
					.set({ isActive: false })
					.where(eq(holidayAssignment.id, assignmentId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday assignment",
						operation: "update",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
