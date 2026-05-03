import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { enterpriseIdentitySetup } from "@/db/schema";

type EnterpriseIdentityRestriction = "inviteRestrictionEnabled" | "domainRestrictionEnabled";

export function isEmailInEnterpriseIdentityDomain(email: string, domain: string | null | undefined) {
	const normalizedDomain = domain?.trim().toLowerCase();
	const normalizedEmail = email.trim().toLowerCase();
	const atIndex = normalizedEmail.lastIndexOf("@");

	if (!normalizedDomain || atIndex <= 0 || atIndex === normalizedEmail.length - 1) return false;

	return normalizedEmail.slice(atIndex + 1) === normalizedDomain;
}

async function getActiveEnterpriseIdentitySetup(organizationId: string) {
	return db.query.enterpriseIdentitySetup.findFirst({
		where: and(
			eq(enterpriseIdentitySetup.organizationId, organizationId),
			eq(enterpriseIdentitySetup.activated, true),
		),
	});
}

export async function assertEnterpriseIdentityEmailAllowed({
	organizationId,
	email,
	restriction,
}: {
	organizationId: string;
	email: string;
	restriction: EnterpriseIdentityRestriction;
}) {
	const setup = await getActiveEnterpriseIdentitySetup(organizationId);

	if (!setup?.domain || !setup.enforcement?.[restriction]) return;

	if (!isEmailInEnterpriseIdentityDomain(email, setup.domain)) {
		throw new Error(`Email must use the enterprise identity domain ${setup.domain}`);
	}
}

export async function assertEnterpriseIdentityInvitationAllowed({
	organizationId,
	email,
}: {
	organizationId: string;
	email: string;
}) {
	await assertEnterpriseIdentityEmailAllowed({
		organizationId,
		email,
		restriction: "inviteRestrictionEnabled",
	});
}

export async function assertEnterpriseIdentityInviteCodeRedemptionAllowed({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}) {
	const userRecord = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { email: true },
	});

	if (!userRecord?.email) {
		throw new Error("User email is required to redeem this invite code");
	}

	await assertEnterpriseIdentityEmailAllowed({
		organizationId,
		email: userRecord.email,
		restriction: "domainRestrictionEnabled",
	});
}
