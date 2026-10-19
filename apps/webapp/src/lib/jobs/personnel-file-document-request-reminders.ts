import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type DocumentRequestReminderResult,
	runDocumentRequestReminders,
} from "@/lib/personnel-file/document-request-reminders";

export type PersonnelFileDocumentRequestRemindersJobResult = DocumentRequestReminderResult;

/**
 * Sends the document request deadline reminders that are due today in each
 * organization's timezone (#1406). Organizations with personnel files off are
 * skipped; sent markers make reruns and retries send nothing again.
 */
export async function runPersonnelFileDocumentRequestRemindersJob(): Promise<PersonnelFileDocumentRequestRemindersJobResult> {
	return runDocumentRequestReminders(db, { now: systemClock.nowInstant() });
}
