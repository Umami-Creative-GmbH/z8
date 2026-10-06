"use server";

import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { enqueueTravelExpenseExportBatch } from "@/lib/travel-expenses/export-processor";
import {
	type CreateTravelExpenseExportBatchResult,
	cancelTravelExpenseExportBatch,
	createTravelExpenseExportBatch,
	listExportableTravelExpenseRevisions,
	listTravelExpenseExportBatches,
	retryTravelExpenseExportBatch,
	TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS,
	type TravelExpenseExportBatchView,
} from "@/lib/travel-expenses/export-store";
import { type FinanceActor, loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import type { SettlementSummary } from "@/lib/travel-expenses/settlement";
import type { SettlementTitle } from "@/lib/travel-expenses/settlement-store";

/**
 * Tracked export batches of approved report revisions (#613). Exporting is
 * its own finance permission (`export:TravelExpenseFinance`); an export never
 * records a reimbursement.
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
}

const batchIdSchema = z.uuid();
const createSchema = z.object({
	idempotencyKey: z.uuid(),
	selection: z
		.array(z.object({ reportId: z.uuid(), revisionId: z.uuid() }))
		.min(1)
		.max(TRAVEL_EXPENSE_EXPORT_MAX_REVISIONS),
});

async function exportActor(): Promise<FinanceActor | null> {
	const actor = await loadFinanceActor();
	return actor?.canExport ? actor : null;
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
			listExportableTravelExpenseRevisions(db, { organizationId: actor.organizationId }),
			listTravelExpenseExportBatches(db, { organizationId: actor.organizationId }),
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
