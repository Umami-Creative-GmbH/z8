import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type DocumentRequestRetentionResult,
	runDocumentRequestRetention,
} from "@/lib/personnel-file/document-request-retention";

export type PersonnelFileDocumentRequestRetentionJobResult = DocumentRequestRetentionResult;

/**
 * Deletes closed document requests without documents whose retention period
 * has passed in each organization's calendar (#1408). Organizations with
 * personnel files off are skipped; a rerun finds nothing left to delete.
 */
export async function runPersonnelFileDocumentRequestRetentionJob(): Promise<PersonnelFileDocumentRequestRetentionJobResult> {
	return runDocumentRequestRetention(db, { now: systemClock.nowInstant() });
}
