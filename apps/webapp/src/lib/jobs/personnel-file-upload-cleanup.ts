import { db } from "@/db";
import { deleteAbandonedPayslipBatches } from "@/lib/personnel-file/payslip-batch-store";
import { deletePersonnelDocumentObject } from "@/lib/personnel-file/storage";
import {
	countOutstandingPersonnelFileCleanup,
	type PersonnelFileCleanupResult,
	runPersonnelFileCleanup,
} from "@/lib/personnel-file/upload-ledger";

export interface PersonnelFileUploadCleanupJobResult extends PersonnelFileCleanupResult {
	success: true;
	/** Cleanup work still recorded after this run, including backed-off failures. */
	outstanding: number;
	/** Open payslip batches nobody touched for two days, deleted in this run (#868). */
	abandonedPayslipBatches: number;
}

/**
 * Deletes personnel file objects of deleted documents (also after an
 * organization hard-delete) and of failed or abandoned uploads (#865),
 * including staged payslip batch files that were never confirmed (#868). It
 * runs regardless of the feature toggle: turning personnel files off never
 * stops deletion work that is already due.
 */
export async function runPersonnelFileUploadCleanupJob(): Promise<PersonnelFileUploadCleanupJobResult> {
	// Clean queued objects before removing expired batches, then count the resulting outstanding ledger.
	// react-doctor-disable-next-line react-doctor/async-parallel
	const result = await runPersonnelFileCleanup(db, {
		deleteObject: deletePersonnelDocumentObject,
	});
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const abandonedPayslipBatches = await deleteAbandonedPayslipBatches(db);
	const outstanding = await countOutstandingPersonnelFileCleanup(db);
	return { success: true, ...result, outstanding, abandonedPayslipBatches };
}
