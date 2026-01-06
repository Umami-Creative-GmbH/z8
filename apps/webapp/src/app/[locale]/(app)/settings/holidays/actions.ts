"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";

interface ServerActionResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Get all holidays for an organization
 */
export async function getHolidays(organizationId: string): Promise<ServerActionResult<any[]>> {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		const holidays = await db
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

		return { success: true, data: holidays };
	} catch (error) {
		console.error("Error fetching holidays:", error);
		return { success: false, error: "Failed to fetch holidays" };
	}
}

/**
 * Get all holiday categories for an organization
 */
export async function getHolidayCategories(
	organizationId: string,
): Promise<ServerActionResult<any[]>> {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		const categories = await db
			.select()
			.from(holidayCategory)
			.where(eq(holidayCategory.organizationId, organizationId))
			.orderBy(holidayCategory.name);

		return { success: true, data: categories };
	} catch (error) {
		console.error("Error fetching holiday categories:", error);
		return { success: false, error: "Failed to fetch categories" };
	}
}

/**
 * Delete a holiday (soft delete by setting isActive = false)
 */
export async function deleteHoliday(holidayId: string): Promise<ServerActionResult> {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		// Get employee record to check role and organization
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return { success: false, error: "Admin access required" };
		}

		// Verify holiday belongs to the same organization
		const [existingHoliday] = await db
			.select()
			.from(holiday)
			.where(
				and(eq(holiday.id, holidayId), eq(holiday.organizationId, employeeRecord.organizationId)),
			)
			.limit(1);

		if (!existingHoliday) {
			return { success: false, error: "Holiday not found" };
		}

		// Soft delete
		await db
			.update(holiday)
			.set({ isActive: false, updatedBy: session.user.id })
			.where(eq(holiday.id, holidayId));

		return { success: true };
	} catch (error) {
		console.error("Error deleting holiday:", error);
		return { success: false, error: "Failed to delete holiday" };
	}
}

/**
 * Delete a category (soft delete, but check if any holidays use it first)
 */
export async function deleteCategory(categoryId: string): Promise<ServerActionResult> {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return { success: false, error: "Not authenticated" };
		}

		// Get employee record to check role and organization
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return { success: false, error: "Admin access required" };
		}

		// Verify category belongs to the same organization
		const [existingCategory] = await db
			.select()
			.from(holidayCategory)
			.where(
				and(
					eq(holidayCategory.id, categoryId),
					eq(holidayCategory.organizationId, employeeRecord.organizationId),
				),
			)
			.limit(1);

		if (!existingCategory) {
			return { success: false, error: "Category not found" };
		}

		// Check if any active holidays use this category
		const holidaysUsingCategory = await db
			.select()
			.from(holiday)
			.where(and(eq(holiday.categoryId, categoryId), eq(holiday.isActive, true)))
			.limit(1);

		if (holidaysUsingCategory.length > 0) {
			return {
				success: false,
				error: "Cannot delete category - it is being used by active holidays",
			};
		}

		// Soft delete
		await db
			.update(holidayCategory)
			.set({ isActive: false })
			.where(eq(holidayCategory.id, categoryId));

		return { success: true };
	} catch (error) {
		console.error("Error deleting category:", error);
		return { success: false, error: "Failed to delete category" };
	}
}
