"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import type { BulkReimbursementResult } from "@/lib/travel-expenses/bulk-reimbursement";
import { enqueueTravelExpenseExportBatch } from "@/lib/travel-expenses/export-processor";
import {
	type ExportBatchReimbursementPreview,
	loadExportBatchReimbursement,
	recordExportBatchReimbursement,
} from "@/lib/travel-expenses/export-reimbursement";
import {
	type CreateTravelExpenseExportBatchResult,
	cancelTravelExpenseExportBatch,
	createTravelExpenseExportBatch,
	isTravelExpenseExportBatchVisible,
	listExportableTravelExpenseRevisions,
	listTravelExpenseExportBatches,
	retryTravelExpenseExportBatch,
	TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS,
	type TravelExpenseExportBatchView,
	type TravelExpenseExportViewer,
} from "@/lib/travel-expenses/export-store";
import { type FinanceActor, loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import type { OfficerScope } from "@/lib/travel-expenses/officer-scope";
import type { SettlementSummary } from "@/lib/travel-expenses/settlement";
import type { SettlementTitle } from "@/lib/travel-expenses/settlement-store";

/**
 * Tracked export batches of approved report revisions (#613). Exporting is
 * its own finance capability, scoped for expense officers (#747); an export
 * never records a reimbursement.
 */

export interface ExportableRevisionRow {
	reportId: string;
	revisionId: string;
	submissionCycle: number;
	employeeName: string | null;
	title: SettlementTitle;
	approvedAt: string | null;
	currency: string | null;
	reimbursable: string | null;
	companyPaid: string | null;
	settlement: SettlementSummary["state"];
	/** Set on an adjustment (#615): the report it corrects; `reimbursable` is then its signed delta. */
	adjustmentOf?: string | null;
}

export interface TravelExpenseExportsView {
	exportable: ExportableRevisionRow[];
	batches: TravelExpenseExportBatchView[];
	maxRevisions: number;
	/** Whether the viewer records reimbursements: completed batches offer "Mark as reimbursed" (#755). */
	canSettle: boolean;
}

const batchIdSchema = z.uuid();
const createSchema = z.object({
	idempotencyKey: z.uuid(),
	selection: z
		.array(z.object({ reportId: z.uuid(), revisionId: z.uuid() }))
		.min(1)
		.max(TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS),
});

type ExportActor = FinanceActor & { exportScope: OfficerScope };

/**
 * Export access needs finance read too: a batch holds approved evidence and
 * receipts. An expense officer exports, and sees batches, in their scope (#747).
 */
async function exportActor(): Promise<ExportActor | null> {
	const actor = await loadFinanceActor();
	const exportScope = actor?.scopes.export;
	return actor?.canExport && actor.canRead && exportScope ? { ...actor, exportScope } : null;
}

function viewerOf(actor: ExportActor): TravelExpenseExportViewer {
	return { employeeId: actor.employeeId, scope: actor.exportScope };
}

/** Whether the actor sees the batch; one they do not see does not exist to them. */
function seesBatch(actor: ExportActor, batchId: string): Promise<boolean> {
	return isTravelExpenseExportBatchVisible(db, {
		organizationId: actor.organizationId,
		batchId,
		viewer: viewerOf(actor),
	});
}

function audit(
	actor: FinanceActor,
	action: AuditAction,
	batchId: string,
	metadata: Record<string, unknown>,
) {
	logAudit({
		action,
		actorId: actor.userId,
		targetId: batchId,
		targetType: "travel_expense_export",
		organizationId: actor.organizationId,
		metadata,
		timestamp: new Date(),
	}).catch((error) => logger.error({ error }, "Failed to audit a travel expense export"));
}

export async function getTravelExpenseExports(): Promise<
	ServerActionResult<TravelExpenseExportsView>
> {
	try {
		const actor = await exportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		const [exportable, batches] = await Promise.all([
			listExportableTravelExpenseRevisions(db, {
				organizationId: actor.organizationId,
				scope: actor.exportScope,
			}),
			listTravelExpenseExportBatches(db, {
				organizationId: actor.organizationId,
				viewer: viewerOf(actor),
			}),
		]);
		return {
			success: true,
			data: {
				exportable: exportable.map(({ reportId, revisionId, submissionCycle, account }) => ({
					reportId,
					revisionId,
					submissionCycle,
					employeeName: account.employeeName,
					title: account.title,
					approvedAt: account.basis?.approvedAt ?? null,
					currency: account.currency,
					// The approved revision's own entitlement (what the export contains).
					reimbursable:
						account.entitlement.find((part) => part.kind === "approved_submission")?.amount ??
						account.adjustmentDelta,
					// An adjustment (#615) exports its signed delta for the report it corrects.
					adjustmentOf: account.adjustmentOf,
					companyPaid: account.basis?.companyPaid ?? null,
					settlement: account.summary.state,
				})),
				batches,
				maxRevisions: TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS,
				canSettle: actor.canSettle,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load travel expense exports");
		return { success: false, error: "Failed to load exports" };
	}
}

export type CreateTravelExpenseExportResult =
	| Exclude<CreateTravelExpenseExportBatchResult, { status: "created" }>
	| { status: "created"; replayed: boolean; batchId: string };

/**
 * Creates a batch from the selected approved revisions and queues it. A
 * retried request with the same idempotency key returns the same batch.
 */
export async function createTravelExpenseExportAction(
	input: z.input<typeof createSchema>,
): Promise<ServerActionResult<CreateTravelExpenseExportResult>> {
	try {
		const parsed = createSchema.safeParse(input);
		if (!parsed.success) return { success: true, data: { status: "invalid_selection" } };
		const actor = await exportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		const result = await createTravelExpenseExportBatch(db, {
			actor,
			scope: actor.exportScope,
			idempotencyKey: parsed.data.idempotencyKey,
			selection: parsed.data.selection,
		});
		if (result.status !== "created") return { success: true, data: result };
		const { batch } = result;
		// A replay re-queues a batch whose job may never have been queued; the
		// job id and the attempt check keep it from running twice.
		if (batch.status === "queued") {
			await enqueueTravelExpenseExportBatch(db, {
				organizationId: actor.organizationId,
				batchId: batch.id,
				attempt: batch.attempt,
			});
		}
		if (!result.replayed) {
			audit(actor, AuditAction.TRAVEL_EXPENSE_EXPORT_CREATED, batch.id, {
				revisionCount: batch.revisionCount,
				reportIds: batch.reports.map((report) => report.reportId),
				manifestDigest: batch.manifestDigest,
			});
		}
		return {
			success: true,
			data: { status: "created", replayed: result.replayed, batchId: batch.id },
		};
	} catch (error) {
		logger.error({ error }, "Failed to create a travel expense export");
		return { success: false, error: "Failed to create the export" };
	}
}

export async function retryTravelExpenseExportAction(
	batchId: string,
): Promise<ServerActionResult<{ status: "queued" | "not_retryable" }>> {
	try {
		if (!batchIdSchema.safeParse(batchId).success) return { success: false, error: "Not found" };
		const actor = await exportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		if (!(await seesBatch(actor, batchId))) return { success: false, error: "Not found" };
		const result = await retryTravelExpenseExportBatch(db, {
			organizationId: actor.organizationId,
			batchId,
		});
		if (result.status === "not_found") return { success: false, error: "Not found" };
		if (result.status === "queued") {
			await enqueueTravelExpenseExportBatch(db, {
				organizationId: actor.organizationId,
				batchId,
				attempt: result.batch.attempt,
			});
			audit(actor, AuditAction.TRAVEL_EXPENSE_EXPORT_RETRIED, batchId, {
				attempt: result.batch.attempt,
			});
		}
		return { success: true, data: { status: result.status } };
	} catch (error) {
		logger.error({ error }, "Failed to retry a travel expense export");
		return { success: false, error: "Failed to retry the export" };
	}
}

export async function cancelTravelExpenseExportAction(
	batchId: string,
): Promise<ServerActionResult<{ status: "cancelled" | "completed" }>> {
	try {
		if (!batchIdSchema.safeParse(batchId).success) return { success: false, error: "Not found" };
		const actor = await exportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		if (!(await seesBatch(actor, batchId))) return { success: false, error: "Not found" };
		const result = await cancelTravelExpenseExportBatch(db, {
			organizationId: actor.organizationId,
			batchId,
			reason: "cancelled_by_finance",
			cancelledByUserId: actor.userId,
		});
		if (result.status === "not_found") return { success: false, error: "Not found" };
		if (result.status === "cancelled" && !result.replayed) {
			audit(actor, AuditAction.TRAVEL_EXPENSE_EXPORT_CANCELLED, batchId, {});
		}
		return { success: true, data: { status: result.status } };
	} catch (error) {
		logger.error({ error }, "Failed to cancel a travel expense export");
		return { success: false, error: "Failed to cancel the export" };
	}
}

/**
 * Marking a batch as reimbursed (#755) is for users who see the batch and
 * record reimbursements; it reimburses within their reimbursement scope.
 */
async function reimbursingExportActor(): Promise<
	(ExportActor & { settleScope: OfficerScope }) | null
> {
	const actor = await exportActor();
	const settleScope = actor?.scopes.settle;
	return actor && settleScope ? { ...actor, settleScope } : null;
}

export type TravelExpenseExportReimbursementView =
	| Extract<ExportBatchReimbursementPreview, { status: "ready" }>
	| { status: "not_completed" };

/** The accounts of a completed batch, as "Mark as reimbursed" offers and skips them. */
export async function getTravelExpenseExportReimbursement(
	batchId: string,
): Promise<ServerActionResult<TravelExpenseExportReimbursementView>> {
	try {
		if (!batchIdSchema.safeParse(batchId).success) return { success: false, error: "Not found" };
		const actor = await reimbursingExportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		if (!(await seesBatch(actor, batchId))) return { success: false, error: "Not found" };
		const result = await loadExportBatchReimbursement(db, {
			organizationId: actor.organizationId,
			batchId,
			scope: actor.settleScope,
			actorEmployeeId: actor.employeeId,
		});
		if (result.status === "not_found") return { success: false, error: "Not found" };
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to load a travel expense export for reimbursement");
		return { success: false, error: "Failed to load the export" };
	}
}

const markReimbursedSchema = z.object({
	batchId: z.uuid(),
	requestKey: z.uuid(),
	accounts: z
		.array(
			z.object({
				// Only report accounts are in a batch; any other source is refused as not in it.
				source: z.object({ type: z.enum(["report", "legacy_claim"]), id: z.uuid() }),
				expectedBalance: z.object({ currency: z.string().max(3), amount: z.string().max(40) }),
			}),
		)
		.min(1)
		.max(TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS),
	occurredOn: z.string().max(10),
	reference: z.string().max(400),
	note: z.string().max(2000).nullable().optional(),
});

/**
 * "Mark as reimbursed" on a completed batch (#755): reimburses each account
 * the officer confirmed in full, like the queue's bulk action, and names the
 * batch on every entry. Repeating it with the same `requestKey` records
 * nothing new; marking the batch again finds its accounts reimbursed.
 */
export async function markTravelExpenseExportReimbursedAction(
	input: z.input<typeof markReimbursedSchema>,
): Promise<ServerActionResult<BulkReimbursementResult>> {
	try {
		const parsed = markReimbursedSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid reimbursement" };
		const actor = await reimbursingExportActor();
		if (!actor) return { success: false, error: "Unauthorized" };
		const { batchId, requestKey, accounts, occurredOn, reference, note } = parsed.data;
		if (!(await seesBatch(actor, batchId))) return { success: false, error: "Not found" };
		const result = await recordExportBatchReimbursement(db, {
			actor,
			scope: actor.settleScope,
			batchId,
			requestKey,
			accounts,
			payment: { occurredOn, reference, note: note ?? null },
		});
		switch (result.status) {
			case "not_found":
				return { success: false, error: "Not found" };
			case "not_completed":
				// The dialog only offers completed batches; the request is stale.
				return { success: false, error: "Export not completed" };
			case "not_in_batch":
				return { success: false, error: "Invalid reimbursement" };
			case "processed":
				if (result.rows.some((row) => row.outcome === "reimbursed" && !row.replayed)) {
					revalidatePath("/travel-expenses");
				}
				return { success: true, data: result };
			default:
				return { success: true, data: result };
		}
	} catch (error) {
		logger.error({ error }, "Failed to mark a travel expense export as reimbursed");
		return { success: false, error: "Failed to mark the export as reimbursed" };
	}
}
