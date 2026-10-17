import { db } from "@/db";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import { cleanupDrivingLicenceEvidence } from "@/lib/organization/driving-licence/retention";
/** Cleanup continues for disabled policies; inactivity must not create an indefinite archive. */
export async function runDrivingLicenceRetentionJob() {
	const organizations = await db
		.select({ id: drivingLicencePolicy.organizationId })
		.from(drivingLicencePolicy);
	let deletedCount = 0;
	const errors: Array<{ organizationId: string; error: string }> = [];
	for (const org of organizations) {
		try {
			deletedCount += (await cleanupDrivingLicenceEvidence(org.id))
				.deletedCount;
		} catch {
			errors.push({
				organizationId: org.id,
				error: "Driving licence retention cleanup failed",
			});
		}
	}
	return { organizationsChecked: organizations.length, deletedCount, errors };
}
