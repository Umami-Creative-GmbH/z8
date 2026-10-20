import "server-only";
import { eq } from "drizzle-orm";
import { drivingLicencePolicy } from "@/db/schema/driving-licence-policy";
import type { DrivingLicenceDatabase } from "./verifiers";

/**
 * Refuses with `not_enabled` while driving licence control is switched off (#1418): policy
 * and interval changes, verifier grants, intended-driver assignments, the Checks worklist and
 * employee records and evidence. Retention, legal-case holds, manual cleanup and the switch
 * itself stay available. Call it inside the caller's transaction, after its locks.
 */
export async function assertDrivingLicenceControlOn(
	database: DrivingLicenceDatabase,
	organizationId: string,
) {
	const [policy] = await database
		.select({ enabled: drivingLicencePolicy.enabled })
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	if (!policy?.enabled) throw new Error("not_enabled");
}
