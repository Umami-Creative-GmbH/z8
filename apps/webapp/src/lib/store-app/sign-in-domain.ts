import {
	verifiedEmailDomain,
	verifiedProviderDomainMatches,
} from "@/lib/auth/sso-organization-provisioning";

/** Verified records only: custom sign-in domains and SSO provider email domains. */
export type StoreAppSignInDomainCandidates = {
	customDomains: ReadonlyArray<{ organizationId: string; domain: string }>;
	ssoProviders: ReadonlyArray<{ organizationId: string | null; domain: string }>;
};

/** Whether `domain` is `emailDomain` or a host under it (`time.acme.example` for `acme.example`). */
export function isDomainUnderEmailDomain(domain: string, emailDomain: string): boolean {
	const host = domain.trim().toLowerCase();
	return host === emailDomain || host.endsWith(`.${emailDomain}`);
}

/**
 * The custom sign-in domain a store app sign-in starts on, or `null` for the
 * main origin (#842).
 *
 * Only the email's domain is used, never the account: the answer is the same
 * whether or not the address exists. An email domain belongs to an
 * organization through a verified custom domain under it or a verified SSO
 * provider domain. If that points at more than one organization, or the
 * organization has no verified custom domain, sign-in starts on the main origin.
 */
export function selectStoreAppSignInDomain(
	email: string,
	candidates: StoreAppSignInDomainCandidates,
): string | null {
	const emailDomain = verifiedEmailDomain(email);
	if (!emailDomain) return null;

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
	if (organizationIds.size !== 1) return null;

	const [organizationId] = organizationIds;
	const domains = candidates.customDomains.filter(
		(custom) => custom.organizationId === organizationId,
	);
	return domains.length === 1 ? (domains[0]?.domain.toLowerCase() ?? null) : null;
}
