"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { currentReportOwner as currentOwner } from "@/lib/travel-expenses/current-owner";
import {
	addWorkPeriodMileage,
	loadWorkPeriodMileage,
	type WorkPeriodMileage,
} from "@/lib/travel-expenses/work-period-mileage";

/**
 * "Add to expense report" on own-vehicle work (#1131, spec #807). Only the
 * employee's own work qualifies; the item is pre-filled on the server from the
 * stored work period, never from client values.
 */

const uuid = z.uuid();

export async function getWorkPeriodMileageAction(
	workPeriodId: string,
): Promise<ServerActionResult<WorkPeriodMileage>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!uuid.safeParse(workPeriodId).success) {
			return { success: true, data: { status: "unavailable" } };
		}
		return { success: true, data: await loadWorkPeriodMileage(db, owner, workPeriodId) };
	} catch (error) {
		logger.error({ error }, "Failed to load work period mileage");
		return { success: false, error: "Failed to load work period mileage" };
	}
}

export type AddWorkPeriodMileageOutcome =
	| { status: "added"; reportId: string; itemId: string }
	/** The work period's distance is already in an expense report. */
	| { status: "already_added"; reportId: string | null };

const addSchema = z.strictObject({ workPeriodId: z.uuid(), reportId: z.uuid().nullable() });

export async function addWorkPeriodMileageAction(input: {
	workPeriodId: string;
	/** A draft trip of the employee, or null for a new standalone mileage report. */
	reportId: string | null;
}): Promise<ServerActionResult<AddWorkPeriodMileageOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = addSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Work period not found" };
		const result = await addWorkPeriodMileage(db, owner, parsed.data);
		switch (result.kind) {
			case "unavailable":
				return { success: false, error: "Work period not found" };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense report can no longer be edited" };
			case "already_added":
				return { success: true, data: { status: "already_added", reportId: result.reportId } };
			case "added":
				break;
		}
		if (parsed.data.reportId === null) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: result.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: {
					model: "report",
					kind: "standalone",
					itemType: "mileage",
					sourceWorkPeriodId: parsed.data.workPeriodId,
				},
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log mileage report creation"));
		}
		revalidatePath("/travel-expenses");
		return {
			success: true,
			data: { status: "added", reportId: result.reportId, itemId: result.itemId },
		};
	} catch (error) {
		logger.error({ error }, "Failed to add work period mileage");
		return { success: false, error: "Failed to add expense" };
	}
}
