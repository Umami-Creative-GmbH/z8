"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	MAX_PER_DIEM_DAYS,
	type PerDiemDraftField,
	type PerDiemDraftInput,
	type PerDiemFieldError,
	parsePerDiemDraft,
} from "@/lib/travel-expenses/per-diem";
import { addTripPerDiemItem, savePerDiemDraft } from "@/lib/travel-expenses/per-diem-store";
import type { ReportItemView, ReportOwner } from "@/lib/travel-expenses/report-store";

/**
 * Per diem actions (#609). The employee sends only the itinerary and the meal
 * facts; the allowance is always the server's calculation.
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

export async function addTripPerDiemItemAction(input: {
	reportId: string;
}): Promise<ServerActionResult<{ item: ReportItemView }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!z.uuid().safeParse(input.reportId).success) {
			return { success: false, error: "Expense report not found" };
		}
		const result = await addTripPerDiemItem(db, owner, { reportId: input.reportId });
		switch (result.kind) {
			case "added":
				revalidatePath("/travel-expenses");
				return { success: true, data: { item: result.item } };
			case "already_exists":
				return { success: false, error: "This trip already has a per diem" };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to add per diem");
		return { success: false, error: "Failed to add expense" };
	}
}

export type SavePerDiemOutcome =
	| { status: "saved"; item: ReportItemView }
	/** A newer version exists; the caller's edits were not written. */
	| { status: "conflict"; item: ReportItemView }
	| { status: "invalid"; errors: Partial<Record<PerDiemDraftField, PerDiemFieldError>> };

const text = z.string().max(100).nullable();
const meal = z.strictObject({ provided: z.boolean(), employeePayment: z.string().max(20).nullable() });
// Strict: a client-supplied amount, rate or total is refused, never ignored silently.
const saveSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	values: z.strictObject({
		startDate: text,
		startTime: text,
		startTimeZone: text,
		endDate: text,
		endTime: text,
		endTimeZone: text,
		overnight: text,
		prolongedWorkplace: z.boolean(),
		meals: z
			.array(
				z.strictObject({ date: z.string().max(10), breakfast: meal, lunch: meal, dinner: meal }),
			)
			.max(MAX_PER_DIEM_DAYS + 1),
	}),
});

export async function savePerDiemDraftAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	values: PerDiemDraftInput;
}): Promise<ServerActionResult<SavePerDiemOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = saveSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid expense draft" };
		const parsed = parsePerDiemDraft(parsedInput.data.values);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await savePerDiemDraft(db, owner, {
			reportId: parsedInput.data.reportId,
			itemId: parsedInput.data.itemId,
			expectedVersion: parsedInput.data.expectedVersion,
			itinerary: parsed.itinerary,
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
		logger.error({ error }, "Failed to save per diem draft");
		return { success: false, error: "Failed to save expense draft" };
	}
}
