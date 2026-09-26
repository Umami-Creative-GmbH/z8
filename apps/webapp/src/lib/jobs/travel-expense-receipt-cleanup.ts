import { db } from "@/db";
import { deletePrivateObject } from "@/lib/storage/export-s3-client";
import {
	countOutstandingTravelExpenseReceiptCleanup,
	type ReceiptCleanupResult,
	runTravelExpenseReceiptCleanup,
} from "@/lib/travel-expenses/receipt-upload";

export interface TravelExpenseReceiptCleanupJobResult extends ReceiptCleanupResult {
	success: true;
	/** Cleanup work still recorded after this run, including backed-off failures. */
	outstanding: number;
}

/** Removes private receipt objects that were rejected, failed or abandoned before attaching. */
export async function runTravelExpenseReceiptCleanupJob(): Promise<TravelExpenseReceiptCleanupJobResult> {
	const result = await runTravelExpenseReceiptCleanup(db, {
		deleteObject: deletePrivateObject,
	});
	const outstanding = await countOutstandingTravelExpenseReceiptCleanup(db);
	return { success: true, ...result, outstanding };
}
