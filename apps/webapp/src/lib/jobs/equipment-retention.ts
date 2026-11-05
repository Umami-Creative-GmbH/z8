import { db } from "@/db";
import { equipmentPolicy } from "@/db/schema/equipment";
import { cleanupEquipmentHistory } from "@/lib/organization/equipment/retention";

export async function runEquipmentRetentionJob() {
	const organizations = await db
		.select({ id: equipmentPolicy.organizationId })
		.from(equipmentPolicy);
	let deletedCount = 0;
	const errors: { organizationId: string; error: string }[] = [];
	for (const org of organizations) {
		try {
			deletedCount += (await cleanupEquipmentHistory(db, org.id)).deletedCount;
		} catch {
			errors.push({
				organizationId: org.id,
				error: "Equipment retention cleanup failed",
			});
		}
	}
	return { organizationsChecked: organizations.length, deletedCount, errors };
}
