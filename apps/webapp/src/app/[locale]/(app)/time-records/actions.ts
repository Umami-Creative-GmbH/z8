"use server";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employee, timeRecord } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import type { CreateTimeRecordInput, ListTimeRecordsFilters, TimeRecord } from "./types";

export async function createTimeRecord(
	input: CreateTimeRecordInput,
): Promise<ServerActionResult<TimeRecord>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const employeeRecord = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, input.employeeId),
				eq(employee.organizationId, authContext.employee.organizationId),
				eq(employee.isActive, true),
			),
		});

		if (!employeeRecord) {
			return { success: false, error: "Employee not found" };
		}

		const [createdRecord] = await db
			.insert(timeRecord)
			.values({
				organizationId: authContext.employee.organizationId,
				employeeId: input.employeeId,
				recordKind: input.recordKind,
				startAt: input.startAt,
				endAt: input.endAt,
				durationMinutes: input.durationMinutes,
				approvalState: input.approvalState,
				origin: input.origin,
				createdBy: authContext.user.id,
				updatedBy: authContext.user.id,
				updatedAt: new Date(),
			})
			.returning();

		if (!createdRecord) {
			return { success: false, error: "Failed to create time record" };
		}

		return { success: true, data: createdRecord };
	} catch (_error) {
		return { success: false, error: "Failed to create time record" };
	}
}

export async function listTimeRecords(
	filters: ListTimeRecordsFilters = {},
): Promise<ServerActionResult<TimeRecord[]>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit <= 0)) {
			return { success: false, error: "Limit must be a positive integer" };
		}

		const conditions = [eq(timeRecord.organizationId, authContext.employee.organizationId)];

		if (filters.employeeId) {
			conditions.push(eq(timeRecord.employeeId, filters.employeeId));
		}

		if (filters.recordKind) {
			conditions.push(eq(timeRecord.recordKind, filters.recordKind));
		}

		if (filters.startAtFrom) {
			conditions.push(gte(timeRecord.startAt, filters.startAtFrom));
		}

		if (filters.startAtTo) {
			conditions.push(lte(timeRecord.startAt, filters.startAtTo));
		}

		const query = db
			.select()
			.from(timeRecord)
			.where(and(...conditions))
			.orderBy(desc(timeRecord.startAt));

		const records =
			filters.limit !== undefined ? await query.limit(filters.limit) : await query;

		return { success: true, data: records };
	} catch (_error) {
		return { success: false, error: "Failed to list time records" };
	}
}
