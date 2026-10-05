"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { deletePrivateObject } from "@/lib/storage/export-s3-client";
import {
	parseReceiptItemDraft,
	type ReceiptItemDraftInput,
	type ReceiptItemFieldError,
	type ReceiptItemDraft,
} from "@/lib/travel-expenses/receipt-report";
import { runTravelExpenseReceiptCleanup } from "@/lib/travel-expenses/receipt-upload";
import { removeReportReceipt } from "@/lib/travel-expenses/report-receipt-upload";
import {
	createStandaloneReceiptReport,
	type DraftReportSummary,
	listOwnDraftReports,
	loadOwnReport,
	type ReportItemView,
	type ReportOwner,
	type ReportView,
	saveReceiptItemDraft,
} from "@/lib/travel-expenses/report-store";

async function currentOwner(): Promise<ReportOwner | null> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

const uuid = z.uuid();

export async function createStandaloneReceiptReportAction(): Promise<
	ServerActionResult<{ reportId: string }>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const { reportId } = await createStandaloneReceiptReport(db, owner);
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
			actorId: owner.userId,
			employeeId: owner.employeeId,
			targetId: reportId,
			targetType: "approval",
			organizationId: owner.organizationId,
			metadata: { model: "report", kind: "standalone" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log expense report creation"));
		revalidatePath("/travel-expenses");
		return { success: true, data: { reportId } };
	} catch (error) {
		logger.error({ error }, "Failed to create expense report");
		return { success: false, error: "Failed to create expense report" };
	}
}

export async function getMyDraftTravelExpenseReports(): Promise<
	ServerActionResult<DraftReportSummary[]>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		return { success: true, data: await listOwnDraftReports(db, owner) };
	} catch (error) {
		logger.error({ error }, "Failed to list draft expense reports");
		return { success: false, error: "Failed to load draft expense reports" };
	}
}

export async function getMyTravelExpenseReport(
	reportId: string,
): Promise<ServerActionResult<ReportView>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const report = uuid.safeParse(reportId).success
			? await loadOwnReport(db, owner, reportId)
			: null;
		if (!report) return { success: false, error: "Expense report not found" };
		return { success: true, data: report };
	} catch (error) {
		logger.error({ error }, "Failed to load expense report");
		return { success: false, error: "Failed to load expense report" };
	}
}

export type SaveReceiptItemOutcome =
	| { status: "saved"; item: ReportItemView }
	/** A newer version exists; the caller's edits were not written. */
	| { status: "conflict"; item: ReportItemView }
	| {
			status: "invalid";
			errors: Partial<Record<keyof ReceiptItemDraft, ReceiptItemFieldError>>;
	  };

const draftFieldSchema = z.string().max(2000).nullable();
const saveSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	values: z.object({
		expenseDate: draftFieldSchema,
		category: draftFieldSchema,
		description: draftFieldSchema,
		amount: draftFieldSchema,
		currency: draftFieldSchema,
		paidBy: draftFieldSchema,
		accountingReference: draftFieldSchema,
	}),
});

export async function saveReceiptItemDraftAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	values: ReceiptItemDraftInput;
}): Promise<ServerActionResult<SaveReceiptItemOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = saveSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid expense draft" };
		const parsed = parseReceiptItemDraft(parsedInput.data.values);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await saveReceiptItemDraft(db, owner, {
			reportId: parsedInput.data.reportId,
			itemId: parsedInput.data.itemId,
			expectedVersion: parsedInput.data.expectedVersion,
			draft: parsed.draft,
		});
		switch (result.kind) {
			case "saved":
			case "conflict":
				return { success: true, data: { status: result.kind, item: result.item } };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save expense draft");
		return { success: false, error: "Failed to save expense draft" };
	}
}

export async function removeReportReceiptAction(input: {
	reportId: string;
	itemId: string;
	receiptId: string;
}): Promise<ServerActionResult<{ receiptId: string }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (![input.reportId, input.itemId, input.receiptId].every((id) => uuid.safeParse(id).success))
			return { success: false, error: "Receipt not found" };
		const result = await removeReportReceipt(db, owner, input);
		if (result.kind === "not_draft")
			return { success: false, error: "This expense can no longer be edited" };
		if (result.kind === "not_found") return { success: false, error: "Receipt not found" };
		// The object is already recorded for durable cleanup; try to delete it now.
		await runTravelExpenseReceiptCleanup(db, {
			deleteObject: deletePrivateObject,
			only: { attachmentId: result.receiptId, organizationId: owner.organizationId },
		}).catch((error) => logger.warn({ error }, "Deferred removed receipt cleanup"));
		return { success: true, data: { receiptId: result.receiptId } };
	} catch (error) {
		logger.error({ error }, "Failed to remove receipt");
		return { success: false, error: "Failed to remove receipt" };
	}
}
