import { db } from "@/db";
import {
	type ContractChangeBatchRecoveryResult,
	type RunContractChangeBatchResult,
	runContractChangeBatch,
	runContractChangeBatchRecovery,
} from "@/lib/contracts/bulk-batch-engine";

export type { ContractChangeBatchRecoveryResult };

/**
 * BullMQ worker processor for async `contract-change-batch` jobs (`> 200` items).
 */
export async function processContractChangeBatchJob(input: {
	batchId: string;
	organizationId: string;
}): Promise<RunContractChangeBatchResult> {
	return runContractChangeBatch(db, {
		organizationId: input.organizationId,
		batchId: input.batchId,
	});
}

/**
 * Periodic cron recovery sweeper resuming stalled pending (>10s) and lease-expired
 * running contract change batches across both `inline` and `async` execution modes.
 */
export async function runContractChangeBatchRecoveryJob(): Promise<ContractChangeBatchRecoveryResult> {
	return runContractChangeBatchRecovery(db);
}
