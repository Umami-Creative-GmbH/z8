import { eq } from "drizzle-orm";
import { DomainsAndBrandingTabs } from "@/components/settings/enterprise/domains-branding-tabs";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getOrganizationPlatformOrigins } from "@/lib/auth-domain-config";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getBrandingAction,
	listDomainsAction,
	listSocialOAuthConfigsAction,
	listSSOProvidersAction,
} from "../actions";

export default async function CustomDomainsPage() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const [domains, branding, providers, socialOAuthConfigs, organizationRecord] = await Promise.all([
		listDomainsAction(),
		getBrandingAction(),
		listSSOProvidersAction(),
		listSocialOAuthConfigsAction(),
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { id: true, slug: true },
		}),
	]);
	const [canonicalDefaultUrl, aliasDefaultUrl] = getOrganizationPlatformOrigins({
		id: organizationId,
		slug: organizationRecord?.slug ?? organizationId,
	});

	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">
						{t("settings.enterprise.domains.title", "Custom Domain & Branding")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.enterprise.domains.description",
							"Configure your organization's custom login domain, branding, and SSO providers.",
						)}
					</p>
				</div>
				<DomainsAndBrandingTabs
					initialDomains={domains as any}
					initialBranding={branding}
					initialProviders={providers as any}
					initialSocialOAuthConfigs={socialOAuthConfigs}
					organizationId={organizationId}
					defaultUrls={{ canonical: canonicalDefaultUrl, alias: aliasDefaultUrl }}
				/>
			</div>
		</div>
	);
}
