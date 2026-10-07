"use server";

import { z } from "zod";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { currentReportOwner as currentOwner } from "@/lib/travel-expenses/current-owner";
import { parseReceiptExceptionDraft } from "@/lib/travel-expenses/receipt-exception";
import type { ReceiptExceptionView } from "@/lib/travel-expenses/receipt-exception-read";
import { saveReceiptExceptionDraft } from "@/lib/travel-expenses/receipt-exception-store";
import type { ReportOwner } from "@/lib/travel-expenses/report-store";

/** Employee actions for missing-receipt exceptions of a draft expense (#604). */

export type SaveReceiptExceptionOutcome =
	| { status: "saved"; receiptException: ReceiptExceptionView }
	/** A newer version exists; the caller's change was not written. */
	| { status: "conflict"; receiptException: ReceiptExceptionView }
	| { status: "invalid"; error: "reason_required" | "too_long" }
	/** The organization does not allow missing-receipt exceptions. */
	| { status: "not_allowed" };

const saveSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().nonnegative(),
	requested: z.boolean(),
	reason: z.string().max(4000).nullable(),
});

export async function saveReceiptExceptionAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	requested: boolean;
	reason: string | null;
}): Promise<ServerActionResult<SaveReceiptExceptionOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = saveSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid missing-receipt exception" };
		const parsed = parseReceiptExceptionDraft(parsedInput.data);
		if (!parsed.ok) return { success: true, data: { status: "invalid", error: parsed.error } };
		const result = await saveReceiptExceptionDraft(db, owner, {
			reportId: parsedInput.data.reportId,
			itemId: parsedInput.data.itemId,
			expectedVersion: parsedInput.data.expectedVersion,
			reason: parsed.reason,
		});
		switch (result.kind) {
			case "saved":
			case "conflict":
				return {
					success: true,
					data: { status: result.kind, receiptException: result.receiptException },
				};
			case "not_allowed":
				return { success: true, data: { status: "not_allowed" } };
			case "not_receipt":
			case "not_found":
				return { success: false, error: "Expense not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save missing-receipt exception");
		return { success: false, error: "Failed to save the missing-receipt explanation" };
	}
}
