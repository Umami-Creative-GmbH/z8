import { systemClock } from "@/lib/datetime/temporal-core";
import { runEquipmentReminders } from "@/lib/organization/equipment/reminders";

/** Organization-local occasions; retries reuse durable per-recipient/channel evidence. */
export async function runEquipmentRemindersJob() {
	return runEquipmentReminders(systemClock);
}
