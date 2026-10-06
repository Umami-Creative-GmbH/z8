"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	type RemoveConversionResult,
	removeCardChargeConversion,
	type SaveConversionResult,
	saveCardChargeConversion,
} from "@/lib/travel-expenses/conversion-store";
import type { ReportOwner } from "@/lib/travel-expenses/report-store";

/**
 * An employee's evidenced card charge for a foreign-currency expense on their
 * own draft report (#607). The charged amount is validated and stored by the
 * server; the reimbursable amount is always derived from it, never taken from
 * the client. Authorized rates are an administrator action (settings).
 */

async function currentOwner(): Promise<ReportOwner | null> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

const itemInput = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
});

const cardChargeInput = itemInput.extend({
	chargedAmount: z.string().max(40),
	evidenceReceiptId: z.uuid(),
});

export async function saveCardChargeConversionAction(
	input: z.input<typeof cardChargeInput>,
): Promise<ServerActionResult<SaveConversionResult>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = cardChargeInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid card charge" };
		const result = await saveCardChargeConversion(db, owner, parsed.data);
		if (result.kind === "saved") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_CONVERSION_RECORDED,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: { itemId: parsed.data.itemId, basis: "card_charge" },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log card charge conversion"));
			revalidatePath("/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to save card charge conversion");
		return { success: false, error: "Failed to save the card charge" };
	}
}

export async function removeCardChargeConversionAction(
	input: z.input<typeof itemInput>,
): Promise<ServerActionResult<RemoveConversionResult>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = itemInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid expense" };
		const result = await removeCardChargeConversion(db, owner, parsed.data);
		if (result.kind === "removed") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_CONVERSION_REMOVED,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: { itemId: parsed.data.itemId, basis: "card_charge" },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log card charge removal"));
			revalidatePath("/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to remove card charge conversion");
		return { success: false, error: "Failed to remove the card charge" };
	}
}
