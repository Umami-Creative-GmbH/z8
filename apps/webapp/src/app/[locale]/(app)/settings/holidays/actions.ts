"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	AuthenticationError,
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
		const session = yield* _(authService.getSession());

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
					.where(eq(holiday.organizationId, organizationId))
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
		const session = yield* _(authService.getSession());

		// Step 2: Get categories from database
		const dbService = yield* _(DatabaseService);
		const categories = yield* _(
			dbService.query("getHolidayCategories", async () => {
				return await dbService.db
					.select()
					.from(holidayCategory)
					.where(eq(holidayCategory.organizationId, organizationId))
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
		const existingHoliday = yield* _(
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
		const existingCategory = yield* _(
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
