export interface SessionSsoProvenance {
	sessionId: string;
	userId: string;
	organizationId: string;
	providerId: string;
}

export interface SessionSsoStore {
	getPolicy(
		organizationId: string,
	): Promise<{ required: boolean; providerId: string | null }>;
	getProvenance(
		sessionId: string,
		organizationId: string,
	): Promise<SessionSsoProvenance | null>;
	saveProvenance(provenance: SessionSsoProvenance): Promise<void>;
}

export class SsoRequiredError extends Error {
	readonly code = "SSO_REQUIRED";
	constructor() {
		super(
			"Sign in with your organization's SSO provider to access this organization",
		);
		this.name = "SsoRequiredError";
	}
}

/** Membership and roles must still be checked by the caller. Proof is never inferred from accounts. */
export async function canAccessOrganizationWithSso(
	store: SessionSsoStore,
	session: { id: string; userId: string } | null | undefined,
	organizationId: string,
): Promise<boolean> {
	if (!session?.id || !session.userId) return false;
	const policy = await store.getPolicy(organizationId);
	if (!policy.required) return true;
	if (!policy.providerId) return false;
	const proof = await store.getProvenance(session.id, organizationId);
	return (
		!!proof &&
		proof.sessionId === session.id &&
		proof.userId === session.userId &&
		proof.organizationId === organizationId &&
		proof.providerId === policy.providerId
	);
}
