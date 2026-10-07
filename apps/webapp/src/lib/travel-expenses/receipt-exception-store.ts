import { and, eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReportItem } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	loadReceiptExceptionsAllowed,
	type ReceiptExceptionView,
	receiptExceptionItemView,
} from "./receipt-exception-read";
import { lockOwnDraftReport, type ReportOwner, touchReport } from "./report-store";

/**
 * Saves of missing-receipt exceptions (#604). An expense's exception is its
 * explanation on the item row with its own version, so it saves under the
 * report lock without racing the expense's other autosaved fields. An
 * exception never creates a receipt row.
 */

type Database = typeof appDb;

export type SaveReceiptExceptionResult =
	| { kind: "saved"; receiptException: ReceiptExceptionView }
	/** The exception changed since `expectedVersion`; nothing was written. */
	| { kind: "conflict"; receiptException: ReceiptExceptionView }
	/** The organization does not allow exceptions; only withdrawing one is possible. */
	| { kind: "not_allowed" }
	/** Mileage and per diem expenses carry no receipt, so they cannot miss one. */
	| { kind: "not_receipt" }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Requests (with an explanation), changes or withdraws (null) the exception of
 * one expense of the owner's draft report, on top of the version the editor
 * last saw. A new or changed request needs the organization to allow it.
 */
export async function saveReceiptExceptionDraft(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string; itemId: string; expectedVersion: number; reason: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<SaveReceiptExceptionResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const report = await lockOwnDraftReport(tx, owner, input.reportId);
		if (report.status !== "draft") return { kind: report.status };
		if (
			input.reason !== null &&
			!(await loadReceiptExceptionsAllowed(tx, owner.organizationId, { lock: "share" }))
		) {
			return { kind: "not_allowed" };
		}
		const item = and(
			eq(travelExpenseReportItem.id, input.itemId),
			eq(travelExpenseReportItem.reportId, input.reportId),
			eq(travelExpenseReportItem.organizationId, owner.organizationId),
		);
		if (input.reason !== null) {
			// Only a receipt expense has a receipt to miss; mileage and per diem never do.
			const [target] = await tx
				.select({ type: travelExpenseReportItem.type })
				.from(travelExpenseReportItem)
				.where(item)
				.limit(1);
			if (!target) return { kind: "not_found" };
			if (target.type !== "receipt") return { kind: "not_receipt" };
		}
		const [saved] = await tx
			.update(travelExpenseReportItem)
			.set({
				receiptExceptionReason: input.reason,
				receiptExceptionVersion: sql`${travelExpenseReportItem.receiptExceptionVersion} + 1`,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.where(and(item, eq(travelExpenseReportItem.receiptExceptionVersion, input.expectedVersion)))
			.returning();
		if (saved) {
			await touchReport(tx, owner, input.reportId, at);
			return { kind: "saved", ...receiptExceptionItemView(saved) };
		}
		const [current] = await tx.select().from(travelExpenseReportItem).where(item);
		return current
			? { kind: "conflict", ...receiptExceptionItemView(current) }
			: { kind: "not_found" };
	});
}
