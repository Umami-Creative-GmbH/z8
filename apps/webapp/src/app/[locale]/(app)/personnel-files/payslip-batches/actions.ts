"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { notifyPayslipBatchShared } from "@/lib/personnel-file/notifications";
import type { PayslipFileFailure } from "@/lib/personnel-file/payslip-batch.types";
import {
	type ConfirmPayslipBatchResult,
	confirmPayslipBatch,
	createPayslipBatch,
	loadPayslipBatchPreview,
	type PayslipBatchFileOutcome,
	type PayslipBatchPreview,
	type PayslipBatchView,
	updatePayslipBatchFile,
} from "@/lib/personnel-file/payslip-batch-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Payslip batch actions (#868). Each resolves the actor's personnel file
 * access first; only the officer (or owner or admin) who started a batch and
 * still manages payslips sees it. Everyone else reads not found.
 */

const NOT_FOUND = "Payslip batch not found";

export type {
	PayslipBatchFileView,
	PayslipBatchPreview,
	PayslipBatchView,
} from "@/lib/personnel-file/payslip-batch-store";

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

export async function startPayslipBatchAction(input: {
	payPeriod: { year: number; month: number };
	visibility: "shared" | "hr_only";
}): Promise<ServerActionResult<PayslipBatchView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved") return { success: false, error: NOT_FOUND };
		const result = await createPayslipBatch(db, current.access, {
			payPeriod: input?.payPeriod,
			visibility: input?.visibility,
		});
		switch (result.kind) {
			case "forbidden":
				return { success: false, error: NOT_FOUND };
			case "invalid":
				return { success: false, error: result.message, code: `invalid_${result.field}` };
			case "created":
				return { success: true, data: result.batch };
		}
	} catch (error) {
		return failure(error, "Failed to start the payslip batch");
	}
}

export async function getPayslipBatchAction(input: {
	batchId: string;
}): Promise<ServerActionResult<PayslipBatchPreview>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.batchId)) {
			return { success: false, error: NOT_FOUND };
		}
		const preview = await loadPayslipBatchPreview(db, current.access, input.batchId);
		return preview ? { success: true, data: preview } : { success: false, error: NOT_FOUND };
	} catch (error) {
		return failure(error, "Failed to load the payslip batch");
	}
}

export async function updatePayslipBatchFileAction(input: {
	batchId: string;
	fileId: string;
	assignedEmployeeId?: string | null;
	included?: boolean;
}): Promise<ServerActionResult<{ fileId: string }>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (
			current.status !== "resolved" ||
			!isCanonicalUuid(input?.batchId) ||
			!isCanonicalUuid(input?.fileId)
		) {
			return { success: false, error: NOT_FOUND };
		}
		const assigned = input.assignedEmployeeId;
		if (assigned !== undefined && assigned !== null && !isCanonicalUuid(assigned)) {
			return { success: false, error: "Choose an employee whose payslips you manage." };
		}
		const result = await updatePayslipBatchFile(db, current.access, {
			batchId: input.batchId,
			fileId: input.fileId,
			assignedEmployeeId: assigned,
			included: typeof input.included === "boolean" ? input.included : undefined,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "invalid":
				return { success: false, error: result.message };
			case "updated":
				return { success: true, data: { fileId: input.fileId } };
		}
	} catch (error) {
		return failure(error, "Failed to update the file");
	}
}

export interface PayslipBatchConfirmation {
	batch: PayslipBatchView;
	created: PayslipBatchFileOutcome[];
	failed: Array<PayslipBatchFileOutcome & { failure: PayslipFileFailure }>;
}

/** Confirms the batch, or retries its failed files; notifies employees of a shared batch once. */
export async function confirmPayslipBatchAction(input: {
	batchId: string;
}): Promise<ServerActionResult<PayslipBatchConfirmation>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(input?.batchId)) {
			return { success: false, error: NOT_FOUND };
		}
		const result: ConfirmPayslipBatchResult = await confirmPayslipBatch(db, current.access, {
			batchId: input.batchId,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "unresolved":
				return {
					success: false,
					error: "Assign every unmatched or ambiguous file to an employee, or drop it.",
					code: "unresolved_files",
				};
			case "confirmed":
				if (result.batch.visibility === "shared") {
					await notifyPayslipBatchShared(db, {
						organizationId: current.access.organizationId,
						batchId: result.batch.id,
						payPeriod: result.batch.payPeriod,
						employees: result.firstDocumentsFor,
					});
				}
				return {
					success: true,
					data: { batch: result.batch, created: result.created, failed: result.failed },
				};
		}
	} catch (error) {
		return failure(error, "Failed to confirm the payslip batch");
	}
}
