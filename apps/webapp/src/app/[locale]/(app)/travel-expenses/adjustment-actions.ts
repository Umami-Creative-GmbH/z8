"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { ADJUSTMENT_REASON_MAX_LENGTH } from "@/lib/travel-expenses/adjustment";
import {
	type CreateAdjustmentResult,
	createTravelExpenseAdjustment,
	loadOwnReportAdjustments,
	type ReportAdjustmentView,
} from "@/lib/travel-expenses/adjustment-store";
import { currentReportOwner as currentOwner } from "@/lib/travel-expenses/current-owner";

/**
 * Adjustments of exported or reimbursed reports (#615). The employee creates a
 * linked correction of their own report; it is submitted and reviewed like
 * any report, so no approval is ever skipped, whatever the sign of its delta.
 */

const createSchema = z.object({
	originalReportId: z.uuid(),
	reason: z.string().max(ADJUSTMENT_REASON_MAX_LENGTH * 2),
	idempotencyKey: z.uuid(),
});

export type CreateTravelExpenseAdjustmentOutcome = Exclude<
	CreateAdjustmentResult,
	{ status: "not_found" }
>;

export async function createTravelExpenseAdjustmentAction(
	input: z.input<typeof createSchema>,
): Promise<ServerActionResult<CreateTravelExpenseAdjustmentOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = createSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Expense report not found" };
		const result = await createTravelExpenseAdjustment(db, { owner, ...parsed.data });
		if (result.status === "not_found") return { success: false, error: "Expense report not found" };
		if (result.status === "created" && !result.replayed) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_ADJUSTMENT_CREATED,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: result.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: { model: "report", originalReportId: parsed.data.originalReportId },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log an expense adjustment"));
			revalidatePath("/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to create an expense adjustment");
		return { success: false, error: "Failed to create the adjustment" };
	}
}

/** The adjustment facts of one of the signed-in employee's reports. */
export async function getTravelExpenseReportAdjustments(
	reportId: string,
): Promise<ServerActionResult<ReportAdjustmentView>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!z.uuid().safeParse(reportId).success) {
			return { success: false, error: "Expense report not found" };
		}
		const view = await loadOwnReportAdjustments(db, owner, reportId);
		if (!view) return { success: false, error: "Expense report not found" };
		return { success: true, data: view };
	} catch (error) {
		logger.error({ error }, "Failed to load expense adjustments");
		return { success: false, error: "Failed to load adjustments" };
	}
}
