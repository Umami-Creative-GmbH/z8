import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { session, ssoProvider } from "@/db/auth-schema";
import { enterpriseIdentitySetup, sessionSsoProvenance } from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import type { MfaSession } from "./access";
import { currentMfaDatabase } from "./database-context";
import { getOrganizationMfaRequirement, type MfaDatabase } from "./store";

/** Unlike Require SSO, a verified exemption is meaningful even while SSO is optional. */
export async function organizationSsoVerification(
	subject: MfaSession,
	organizationId: string,
	database: MfaDatabase = currentMfaDatabase() ?? db,
): Promise<string | null> {
	if (subject.impersonatedBy) return null;
	const [proof] = await database
		.select({ verifiedAt: sessionSsoProvenance.verifiedAt })
		.from(sessionSsoProvenance)
		.innerJoin(
			session,
			and(
				eq(session.id, sessionSsoProvenance.sessionId),
				eq(session.userId, sessionSsoProvenance.userId),
				isNull(session.impersonatedBy),
				gt(session.expiresAt, dateFromInstant(systemClock.nowInstant())),
			),
		)
		.innerJoin(
			enterpriseIdentitySetup,
			and(
				eq(enterpriseIdentitySetup.organizationId, organizationId),
				eq(enterpriseIdentitySetup.activated, true),
				eq(enterpriseIdentitySetup.providerId, sessionSsoProvenance.providerId),
			),
		)
		.innerJoin(
			ssoProvider,
			and(
				eq(ssoProvider.providerId, sessionSsoProvenance.providerId),
				eq(ssoProvider.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(sessionSsoProvenance.sessionId, subject.id),
				eq(sessionSsoProvenance.userId, subject.userId),
				eq(sessionSsoProvenance.organizationId, organizationId),
			),
		);
	return proof?.verifiedAt.toISOString() ?? null;
}

export async function getOrganizationAccessRequirement(
	subject: MfaSession | null | undefined,
	organizationId: string,
	database?: typeof db,
) {
	if (
		!subject ||
		!(await canAccessOrganizationWithSso(subject, organizationId, database))
	)
		return { allowed: false, reason: "SSO_REQUIRED" } as const;
	return getOrganizationMfaRequirement(
		subject,
		organizationId,
		!!(await organizationSsoVerification(subject, organizationId, database)),
		database,
	);
}

/** Authentication gate; callers separately enforce membership, lifecycle and operation permissions. */
export async function canAccessOrganization(
	subject: MfaSession | null | undefined,
	organizationId: string,
	database?: typeof db,
): Promise<boolean> {
	return (
		await getOrganizationAccessRequirement(subject, organizationId, database)
	).allowed;
}
