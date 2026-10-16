import { systemClock } from "@/lib/datetime/temporal-core";
import { runDrivingLicenceReminders } from "@/lib/organization/driving-licence/reminders";

/** Scheduled entry: deadlines are evaluated using each authorization's fixed zone. */
export async function runDrivingLicenceRemindersJob() {
	return runDrivingLicenceReminders(systemClock);
}
