import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { deletePersonalDataExportObject } from "@/lib/personal-data-export/processor";
import {
	countPersonalDataExportFileCleanup,
	drainPersonalDataExportFileCleanup,
	expirePersonalDataExports,
	failStalePersonalDataExports,
} from "@/lib/personal-data-export/store";

export interface PersonalDataExportSweepResult {
	/** Exports past their 7 days, deleted with their rows. */
	expired: number;
	/** Builds given up after staying pending or processing too long. */
	timedOut: number;
	/** Stored files deleted in this run. */
	filesDeleted: number;
	/** Stored files whose deletion failed in this run (retried later). */
	filesFailed: number;
	/** Stored files still waiting for deletion. */
	outstanding: number;
}

/**
 * Personal data export sweep (#811): gives up stuck builds, deletes exports
 * 7 days after completion (selected in SQL), then deletes the stored files of
 * every deleted export, including those removed with their employee or
 * organization.
 */
export async function runPersonalDataExportSweep(): Promise<PersonalDataExportSweepResult> {
	const now = systemClock.nowInstant();
	// Sequential on purpose: expiry feeds the file cleanup ledger the drain reads.
	// react-doctor-disable-next-line react-doctor/async-parallel
	const timedOut = await failStalePersonalDataExports(db, { now });
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const expired = await expirePersonalDataExports(db, { now });
	const files = await drainPersonalDataExportFileCleanup(db, {
		now,
		deleteObject: deletePersonalDataExportObject,
	});
	const outstanding = await countPersonalDataExportFileCleanup(db);
	return {
		expired,
		timedOut,
		filesDeleted: files.deleted,
		filesFailed: files.failed,
		outstanding,
	};
}
