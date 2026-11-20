import { AUTH_SSO_DOMAIN_VERIFICATION } from "@/lib/auth/auth-schema-options";

export interface SsoDomainTxtRecord {
	/** Host label to enter in DNS panels that append the zone automatically. */
	host: string;
	/** Fully qualified record name Better Auth resolves. */
	fqdn: string;
	value: string;
}

/**
 * The DNS TXT record Better Auth SSO looks up to verify a provider's domain:
 * `_<tokenPrefix>-<providerId>.<domain>` holding the verification token.
 */
export function getSsoDomainTxtRecord(input: {
	providerId: string;
	domain: string;
	token: string;
}): SsoDomainTxtRecord {
	const host = `_${AUTH_SSO_DOMAIN_VERIFICATION.tokenPrefix}-${input.providerId}`;
	return { host, fqdn: `${host}.${input.domain}`, value: input.token };
}
