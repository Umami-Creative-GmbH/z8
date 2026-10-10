import "server-only";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import { ssoProvider } from "@/db/auth-schema";
import { organizationDomain } from "@/db/schema";
import {
	verifiedEmailDomain,
	verifiedProviderDomainMatches,
} from "@/lib/auth/sso-organization-provisioning";
import { selectStoreAppSignInDomain } from "./sign-in-domain";

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Origin a store app sign-in starts on for this email (#842): the verified
 * custom sign-in domain of the one organization the email's domain belongs to,
 * otherwise `mainOrigin`. See `selectStoreAppSignInDomain`.
 */
export async function resolveStoreAppSignInOrigin(
	email: string,
	mainOrigin: string,
): Promise<string> {
	const emailDomain = verifiedEmailDomain(email);
	if (!emailDomain) return mainOrigin;

	const [customDomains, ssoProviders] = await Promise.all([
		db
			.select({
				organizationId: organizationDomain.organizationId,
				domain: organizationDomain.domain,
			})
			.from(organizationDomain)
			.where(
				and(
					eq(organizationDomain.domainVerified, true),
					or(
						eq(organizationDomain.domain, emailDomain),
						like(organizationDomain.domain, `%.${escapeLikePattern(emailDomain)}`),
					),
				),
			),
		// Provider domains are comma-separated lists; the provisioning rule matches them in code.
		db
			.select({ organizationId: ssoProvider.organizationId, domain: ssoProvider.domain })
			.from(ssoProvider)
			.where(eq(ssoProvider.domainVerified, true)),
	]);

	const matchingProviders = ssoProviders.filter((provider) =>
		verifiedProviderDomainMatches(emailDomain, provider.domain),
	);
	// SSO-matched organizations may keep their custom domain outside the email's domain.
	const ssoOrganizationIds = [
		...new Set(matchingProviders.flatMap((provider) => provider.organizationId ?? [])),
	];
	const ssoCustomDomains =
		ssoOrganizationIds.length > 0
			? await db
					.select({
						organizationId: organizationDomain.organizationId,
						domain: organizationDomain.domain,
					})
					.from(organizationDomain)
					.where(
						and(
							eq(organizationDomain.domainVerified, true),
							inArray(organizationDomain.organizationId, ssoOrganizationIds),
						),
					)
			: [];

	const byDomain = new Map([...customDomains, ...ssoCustomDomains].map((row) => [row.domain, row]));
	const domain = selectStoreAppSignInDomain(email, {
		customDomains: [...byDomain.values()],
		ssoProviders: matchingProviders,
	});
	return domain ? `https://${domain}` : mainOrigin;
}
