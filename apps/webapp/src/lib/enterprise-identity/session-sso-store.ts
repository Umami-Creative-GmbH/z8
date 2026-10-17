import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { session, ssoProvider } from "@/db/auth-schema";
import { enterpriseIdentitySetup } from "@/db/schema/enterprise-identity-setup";
import { sessionSsoProvenance } from "@/db/schema/session-sso-provenance";
import { currentMfaDatabase } from "@/lib/organization-mfa/database-context";
import {
	canAccessOrganizationWithSso as canAccess,
	type SessionSsoStore,
	SsoRequiredError,
} from "./session-sso";

export function resolveOrganizationSsoPolicy(
	setup:
		| {
				activated: boolean;
				enforcement: { ssoRequired: boolean };
				providerId: string | null;
		  }
		| null
		| undefined,
	registeredProviderId: string | null | undefined,
) {
	if (!setup?.activated) return { required: false, providerId: null };
	return {
		required: setup.enforcement.ssoRequired,
		providerId:
			registeredProviderId === setup.providerId ? setup.providerId : null,
	};
}

/** No cross-request cache: activation, provider changes, and missing proof take effect immediately. */
export function createSessionSsoStore(database: typeof db): SessionSsoStore {
	return {
		async getPolicy(organizationId) {
			const [row] = await (currentMfaDatabase() ?? database)
				.select({
					setup: enterpriseIdentitySetup,
					registeredProviderId: ssoProvider.providerId,
				})
				.from(enterpriseIdentitySetup)
				.leftJoin(
					ssoProvider,
					and(
						eq(ssoProvider.providerId, enterpriseIdentitySetup.providerId),
						eq(ssoProvider.organizationId, organizationId),
					),
				)
				.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
				.limit(1);
			return resolveOrganizationSsoPolicy(
				row?.setup,
				row?.registeredProviderId,
			);
		},
		async getProvenance(sessionId, organizationId) {
			const [row] = await (currentMfaDatabase() ?? database)
				.select({ proof: sessionSsoProvenance })
				.from(sessionSsoProvenance)
				.innerJoin(
					session,
					and(
						eq(session.id, sessionSsoProvenance.sessionId),
						eq(session.userId, sessionSsoProvenance.userId),
					),
				)
				.where(
					and(
						eq(sessionSsoProvenance.sessionId, sessionId),
						eq(sessionSsoProvenance.organizationId, organizationId),
					),
				)
				.limit(1);
			return row?.proof ?? null;
		},
		async saveProvenance(provenance) {
			// An existing session can never be upgraded/rebound by a later request.
			await (currentMfaDatabase() ?? database)
				.insert(sessionSsoProvenance)
				.values(provenance);
		},
	};
}
export const sessionSsoStore = createSessionSsoStore(db);

export function canAccessOrganizationWithSso(
	session: { id: string; userId: string } | null | undefined,
	organizationId: string,
	database?: typeof db,
) {
	return canAccess(
		database ? createSessionSsoStore(database) : sessionSsoStore,
		session,
		organizationId,
	);
}

export async function assertOrganizationSsoAccess(
	session: { id: string; userId: string } | null | undefined,
	organizationId: string,
) {
	if (!(await canAccessOrganizationWithSso(session, organizationId)))
		throw new SsoRequiredError();
}
