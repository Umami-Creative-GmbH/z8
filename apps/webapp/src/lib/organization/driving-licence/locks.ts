import "server-only";
import { eq, sql } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import type { DrivingLicenceTransaction } from "./verifiers";

export async function lockDrivingLicenceOrganization(
	tx: DrivingLicenceTransaction,
	organizationId: string,
) {
	// Lifecycle already holds this row exclusively before entering driving control.
	// Take it before the driving key everywhere to avoid an inverted lock order.
	await tx
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.for("share");
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`driving-licence:${organizationId}`},0))`,
	);
}
