import { db } from "@/db";
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
}

/**
 * Deletes personnel file objects of deleted documents (also after an
 * organization hard-delete) and of failed or abandoned uploads (#865). It runs
 * regardless of the feature toggle: turning personnel files off never stops
 * deletion work that is already due.
 */
export async function runPersonnelFileUploadCleanupJob(): Promise<PersonnelFileUploadCleanupJobResult> {
	const result = await runPersonnelFileCleanup(db, {
		deleteObject: deletePersonnelDocumentObject,
	});
	const outstanding = await countOutstandingPersonnelFileCleanup(db);
	return { success: true, ...result, outstanding };
}
