import { db } from "@/db";
import {
	type AbsenceDeputyReminderResult,
	runAbsenceDeputyReminders,
} from "@/lib/absences/deputy-notifier";
import { systemClock } from "@/lib/datetime/temporal-core";

export type AbsenceDeputyRemindersJobResult = AbsenceDeputyReminderResult;

/**
 * Reminds deputies the day before an approved absence they cover starts, in
 * the absent employee's timezone (#1013). Sent markers make reruns and
 * retries send nothing again.
 */
export async function runAbsenceDeputyRemindersJob(): Promise<AbsenceDeputyRemindersJobResult> {
	return runAbsenceDeputyReminders(db, { now: systemClock.nowInstant() });
}
