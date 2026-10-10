import "server-only";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import { ssoProvider } from "@/db/auth-schema";
import { organizationDomain } from "@/db/schema";
import { verifiedEmailDomain } from "@/lib/auth/sso-organization-provisioning";
import { organizationsOfEmailDomain, selectStoreAppSignInDomain } from "./sign-in-domain";

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Origin a store app sign-in starts on for this email (#842): the verified
 * custom sign-in domain of the one organization the email's domain belongs to,
 * otherwise `mainOrigin`. The email's domain is derived and matched once here;
 * the rules are in sign-in-domain.ts.
 *
 * Accepted deviation from #842 ("reveal no more than the web sign-in page"):
 * this unauthenticated lookup reveals, for an email domain, that the
 * organization is a customer and which custom sign-in domain it uses. It was
 * accepted because that domain is public anyway, through DNS and its branded
 * sign-in page. It never reveals whether the address itself has an account.
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

	const organizationIds = organizationsOfEmailDomain(emailDomain, { customDomains, ssoProviders });
	// An SSO-matched organization may keep its custom domain outside the email's domain.
	const organizationCustomDomains =
		organizationIds.size > 0
			? await db
					.select({
						organizationId: organizationDomain.organizationId,
						domain: organizationDomain.domain,
					})
					.from(organizationDomain)
					.where(
						and(
							eq(organizationDomain.domainVerified, true),
							inArray(organizationDomain.organizationId, [...organizationIds]),
						),
					)
			: [];

	const domain = selectStoreAppSignInDomain(organizationIds, organizationCustomDomains);
	return domain ? `https://${domain}` : mainOrigin;
}
