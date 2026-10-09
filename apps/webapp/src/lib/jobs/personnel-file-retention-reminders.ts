import { db } from "@/db";
import {
	type RetentionRemindersResult,
	runPersonnelFileRetentionReminders,
} from "@/lib/personnel-file/retention-reminders";

export interface PersonnelFileRetentionRemindersJobResult extends RetentionRemindersResult {
	success: true;
}

/**
 * Tells covering officers about employee documents newly due for deletion
 * (#870). Hourly, so each organization's day is reached soon after its local
 * midnight; recipients still get at most one reminder per organization day.
 * Skips organizations with personnel files off. Never deletes anything.
 */
export async function runPersonnelFileRetentionRemindersJob(): Promise<PersonnelFileRetentionRemindersJobResult> {
	const result = await runPersonnelFileRetentionReminders(db);
	return { success: true, ...result };
}
