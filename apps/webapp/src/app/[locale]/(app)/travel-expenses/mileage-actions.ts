"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { currentReportOwner as currentOwner } from "@/lib/travel-expenses/current-owner";
import {
	type MileageItemDraft,
	type MileageItemDraftInput,
	type MileageItemFieldError,
	parseMileageItemDraft,
} from "@/lib/travel-expenses/mileage";
import {
	addTripMileageItem,
	createStandaloneMileageReport,
	saveMileageItemDraft,
} from "@/lib/travel-expenses/mileage-item-store";
import type { ReportItemView, ReportOwner } from "@/lib/travel-expenses/report-store";

/**
 * Mileage expense actions (#606). The employee sends only date, route,
 * distance and vehicle; the amount is always the server's calculation.
 */

export async function createStandaloneMileageReportAction(): Promise<
	ServerActionResult<{ reportId: string }>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const { reportId } = await createStandaloneMileageReport(db, owner);
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
			actorId: owner.userId,
			employeeId: owner.employeeId,
			targetId: reportId,
			targetType: "approval",
			organizationId: owner.organizationId,
			metadata: { model: "report", kind: "standalone", itemType: "mileage" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log mileage report creation"));
		revalidatePath("/travel-expenses");
		return { success: true, data: { reportId } };
	} catch (error) {
		logger.error({ error }, "Failed to create mileage report");
		return { success: false, error: "Failed to create expense report" };
	}
}

export async function addTripMileageItemAction(input: {
	reportId: string;
}): Promise<ServerActionResult<{ item: ReportItemView }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!z.uuid().safeParse(input.reportId).success) {
			return { success: false, error: "Expense report not found" };
		}
		const result = await addTripMileageItem(db, owner, { reportId: input.reportId });
		switch (result.kind) {
			case "added":
				return { success: true, data: { item: result.item } };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to add mileage expense");
		return { success: false, error: "Failed to add expense" };
	}
}

export type SaveMileageItemOutcome =
	| { status: "saved"; item: ReportItemView }
	/** A newer version exists; the caller's edits were not written. */
	| { status: "conflict"; item: ReportItemView }
	| {
			status: "invalid";
			errors: Partial<Record<keyof MileageItemDraft, MileageItemFieldError>>;
	  };

const field = z.string().max(2000).nullable();
// Strict: a client-supplied amount, rate or total is refused, never ignored silently.
const saveSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	values: z.strictObject({
		expenseDate: field,
		route: field,
		distanceKm: field,
		vehicle: field,
		accountingReference: field,
	}),
});

export async function saveMileageItemDraftAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	values: MileageItemDraftInput;
}): Promise<ServerActionResult<SaveMileageItemOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = saveSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid expense draft" };
		const parsed = parseMileageItemDraft(parsedInput.data.values);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await saveMileageItemDraft(db, owner, {
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
		logger.error({ error }, "Failed to save mileage draft");
		return { success: false, error: "Failed to save expense draft" };
	}
}
