import "server-only";

// Setup-record writer for actions that have already authorized the organization
// admin (#443): not a server action, so a client cannot create records for any
// organization ID.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enterpriseIdentitySetup } from "@/db/schema";
import { createDefaultEnterpriseIdentitySetupState } from "@/lib/enterprise-identity/setup-state";

export type EnterpriseIdentitySetupRecord = typeof enterpriseIdentitySetup.$inferSelect;

export async function getOrCreateEnterpriseIdentitySetupRecord(
	organizationId: string,
	userId: string,
): Promise<EnterpriseIdentitySetupRecord> {
	const existing = await db.query.enterpriseIdentitySetup.findFirst({
		where: eq(enterpriseIdentitySetup.organizationId, organizationId),
	});

	if (existing) return existing;

	const defaultState = createDefaultEnterpriseIdentitySetupState({
		organizationId,
	});
	const [created] = await db
		.insert(enterpriseIdentitySetup)
		.values({
			organizationId,
			currentStep: defaultState.currentStep,
			ssoTest: defaultState.ssoTest,
			scim: defaultState.scim,
			enforcement: defaultState.enforcement,
			createdBy: userId,
			updatedBy: userId,
		})
		.onConflictDoNothing({ target: enterpriseIdentitySetup.organizationId })
		.returning();

	if (created) return created;

	const raced = await db.query.enterpriseIdentitySetup.findFirst({
		where: eq(enterpriseIdentitySetup.organizationId, organizationId),
	});

	if (!raced) throw new Error("Unable to initialize enterprise identity setup");
	return raced;
}
