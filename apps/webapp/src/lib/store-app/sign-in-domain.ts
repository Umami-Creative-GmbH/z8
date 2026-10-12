import { verifiedProviderDomainMatches } from "@/lib/auth/sso-organization-provisioning";

/**
 * Where a store app sign-in starts (#842), in two pure steps that
 * `resolveStoreAppSignInOrigin` (sign-in-origin.ts) runs around its queries.
 *
 * Only the email's domain is used, never the account: the answer is the same
 * whether or not the address exists.
 */

/** Verified records only: custom sign-in domains and SSO provider email domains. */
export type StoreAppSignInDomainCandidates = {
	customDomains: ReadonlyArray<{ organizationId: string; domain: string }>;
	ssoProviders: ReadonlyArray<{ organizationId: string | null; domain: string }>;
};

/** Whether `domain` is `emailDomain` or a host under it (`time.acme.example` for `acme.example`). */
function isDomainUnderEmailDomain(domain: string, emailDomain: string): boolean {
	const host = domain.trim().toLowerCase();
	return host === emailDomain || host.endsWith(`.${emailDomain}`);
}

/**
 * The organizations a (verified, lower-case) email domain belongs to: through a
 * verified custom domain equal to or under it, or a verified SSO provider domain
 * that matches it by the SSO provisioning rule.
 */
export function organizationsOfEmailDomain(
	emailDomain: string,
	candidates: StoreAppSignInDomainCandidates,
): Set<string> {
	const organizationIds = new Set<string>();
	for (const custom of candidates.customDomains) {
		if (isDomainUnderEmailDomain(custom.domain, emailDomain)) {
			organizationIds.add(custom.organizationId);
		}
	}
	for (const provider of candidates.ssoProviders) {
		if (provider.organizationId && verifiedProviderDomainMatches(emailDomain, provider.domain)) {
			organizationIds.add(provider.organizationId);
		}
	}
	return organizationIds;
}

/**
 * The custom sign-in domain to start on, or `null` for the main origin: only
 * when the email's domain belongs to exactly one organization and that
 * organization has exactly one verified custom domain (`customDomains` may hold
 * other organizations' domains too).
 */
export function selectStoreAppSignInDomain(
	organizationIds: ReadonlySet<string>,
	customDomains: StoreAppSignInDomainCandidates["customDomains"],
): string | null {
	if (organizationIds.size !== 1) return null;

	const [organizationId] = organizationIds;
	const domains = customDomains.filter((custom) => custom.organizationId === organizationId);
	return domains.length === 1 ? (domains[0]?.domain.toLowerCase() ?? null) : null;
}
