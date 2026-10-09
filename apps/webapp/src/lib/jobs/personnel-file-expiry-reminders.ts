import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type PersonnelFileExpiryReminderResult,
	runPersonnelFileExpiryReminders,
} from "@/lib/personnel-file/expiry-reminders";

export type PersonnelFileExpiryRemindersJobResult = PersonnelFileExpiryReminderResult;

/**
 * Sends the personnel file expiry reminders that are due today in each
 * organization's timezone (#869). Organizations with personnel files off are
 * skipped; sent markers make reruns and retries send nothing again.
 */
export async function runPersonnelFileExpiryRemindersJob(): Promise<PersonnelFileExpiryRemindersJobResult> {
	return runPersonnelFileExpiryReminders(db, { now: systemClock.nowInstant() });
}
