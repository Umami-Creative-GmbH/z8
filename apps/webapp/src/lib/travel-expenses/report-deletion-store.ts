import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseLegacyDraftConversion,
	travelExpenseReceiptUpload,
	travelExpenseReport,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { hasApprovalHistory } from "./legacy-draft-conversion-store";
import { isDeletableDraftReport } from "./report-deletion";
import type { ReportOwner } from "./report-store";

/**
 * Deleting a draft report (#684), the store. The owner deletes one of their
 * own drafts that was never submitted, under the report row lock that every
 * edit and the submission take. Its expenses, receipts, conversions, per diem
 * and adjustment link cascade; the receipt deletion trigger (migration 0116)
 * hands the stored objects to the cleanup worker, which keeps any object
 * another receipt or legacy attachment still names. A draft continued from a
 * legacy claim (#616) takes that legacy draft with it, so it does not come
 * back to be continued again.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DeleteDraftReportResult =
	| {
			kind: "deleted";
			/** Receipt cleanup work recorded by the deletion, for an immediate attempt. */
			cleanupIds: string[];
			/** The legacy draft deleted with it, if the report continued one. */
			legacyClaimId: string | null;
	  }
	| { kind: "not_found" }
	/** Submitted, returned, decided or withdrawn: the report keeps its history. */
	| { kind: "not_deletable" };

function ownedReport(owner: ReportOwner, reportId: string) {
	return and(
		eq(travelExpenseReport.id, reportId),
		eq(travelExpenseReport.organizationId, owner.organizationId),
		eq(travelExpenseReport.employeeId, owner.employeeId),
	);
}

/**
 * Locks the legacy draft the report continues, when it is still a draft of
 * the owner without approval history; null otherwise. A claim that was
 * submitted keeps its own history and is never deleted here.
 */
async function lockContinuedLegacyDraft(tx: Transaction, owner: ReportOwner, reportId: string) {
	const [conversion] = await tx
		.select({ claimId: travelExpenseLegacyDraftConversion.claimId })
		.from(travelExpenseLegacyDraftConversion)
		.where(
			and(
				eq(travelExpenseLegacyDraftConversion.organizationId, owner.organizationId),
				eq(travelExpenseLegacyDraftConversion.reportId, reportId),
			),
		)
		.limit(1);
	if (!conversion) return null;
	// The lock legacy receipt finalization and conversion take.
	const [claim] = await tx
		.select({ id: travelExpenseClaim.id, status: travelExpenseClaim.status })
		.from(travelExpenseClaim)
		.where(
			and(
				eq(travelExpenseClaim.id, conversion.claimId),
				eq(travelExpenseClaim.organizationId, owner.organizationId),
				eq(travelExpenseClaim.employeeId, owner.employeeId),
			),
		)
		.for("update");
	if (claim?.status !== "draft") return null;
	if (await hasApprovalHistory(tx, owner.organizationId, claim.id)) return null;
	return claim;
}

export async function deleteOwnDraftReport(
	database: Database,
	owner: ReportOwner,
	input: { reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<DeleteDraftReportResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx): Promise<DeleteDraftReportResult> => {
		const [report] = await tx
			.select({
				status: travelExpenseReport.status,
				submissionCount: travelExpenseReport.submissionCount,
			})
			.from(travelExpenseReport)
			.where(ownedReport(owner, input.reportId))
			.for("update");
		if (!report) return { kind: "not_found" };
		if (!isDeletableDraftReport(report)) return { kind: "not_deletable" };

		const legacyClaim = await lockContinuedLegacyDraft(tx, owner, input.reportId);
		const [receipts, attachments] = await Promise.all([
			tx
				.select({ id: travelExpenseReportReceipt.id })
				.from(travelExpenseReportReceipt)
				.where(
					and(
						eq(travelExpenseReportReceipt.reportId, input.reportId),
						eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
					),
				),
			legacyClaim
				? tx
						.select()
						.from(travelExpenseAttachment)
						.where(
							and(
								eq(travelExpenseAttachment.claimId, legacyClaim.id),
								eq(travelExpenseAttachment.organizationId, owner.organizationId),
							),
						)
				: Promise.resolve([]),
		]);

		await tx.delete(travelExpenseReport).where(ownedReport(owner, input.reportId));
		if (legacyClaim) {
			if (attachments.length > 0) {
				// A key the deleted receipts already recorded keeps that work (the unique key).
				await tx
					.insert(travelExpenseReceiptUpload)
					.values(
						attachments.map((attachment) => ({
							id: attachment.id,
							organizationId: owner.organizationId,
							claimId: legacyClaim.id,
							uploadedBy: attachment.uploadedBy,
							storageKey: attachment.storageKey,
							storageBucket: attachment.storageBucket,
							storageVersionId: attachment.storageVersionId,
							status: "cleanup_required" as const,
							reason: "removed" as const,
							nextAttemptAt: at,
							createdAt: at,
							updatedAt: at,
						})),
					)
					.onConflictDoNothing();
			}
			await tx
				.delete(travelExpenseClaim)
				.where(
					and(
						eq(travelExpenseClaim.id, legacyClaim.id),
						eq(travelExpenseClaim.organizationId, owner.organizationId),
					),
				);
		}

		const cleanupIds = [...receipts, ...attachments].map((row) => row.id);
		if (receipts.length > 0) {
			// The trigger stamps database time; align it with the clock the worker uses.
			await tx
				.update(travelExpenseReceiptUpload)
				.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
				.where(
					and(
						inArray(
							travelExpenseReceiptUpload.id,
							receipts.map((receipt) => receipt.id),
						),
						eq(travelExpenseReceiptUpload.organizationId, owner.organizationId),
						eq(travelExpenseReceiptUpload.status, "cleanup_required"),
					),
				);
		}
		return { kind: "deleted", cleanupIds, legacyClaimId: legacyClaim?.id ?? null };
	});
}
