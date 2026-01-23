import { redirect } from "next/navigation";
import { DomainsAndBrandingTabs } from "@/components/settings/enterprise/domains-branding-tabs";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getBrandingAction,
	listDomainsAction,
	listSocialOAuthConfigsAction,
	listSSOProvidersAction,
} from "../actions";

export default async function CustomDomainsPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	const [domains, branding, providers, socialOAuthConfigs] = await Promise.all([
		listDomainsAction(),
		getBrandingAction(),
		listSSOProvidersAction(),
		listSocialOAuthConfigsAction(),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">{t("settings.enterprise.domains.title", "Custom Domain & Branding")}</h1>
					<p className="text-muted-foreground">
						{t("settings.enterprise.domains.description", "Configure your organization's custom login domain, branding, and SSO providers.")}
					</p>
				</div>
				<DomainsAndBrandingTabs
					initialDomains={domains as any}
					initialBranding={branding}
					initialProviders={providers as any}
					initialSocialOAuthConfigs={socialOAuthConfigs}
					organizationId={authContext.employee?.organizationId ?? ""}
				/>
			</div>
		</div>
	);
}
