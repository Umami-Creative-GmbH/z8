"use client";

import { useTranslate } from "@tolgee/react";
import type { SocialOAuthConfigResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AuthConfig, OrganizationBranding } from "@/lib/domain";
import { BrandingForm } from "./branding-form";
import { DomainManagement } from "./domain-management";
import { SocialOAuthManagement } from "./social-oauth-management";
import { SSOProviderManagement } from "./sso-provider-management";

interface Domain {
	id: string;
	domain: string;
	domainVerified: boolean;
	isPrimary: boolean;
	verificationToken: string | null;
	verificationTokenExpiresAt: Date | null;
	authConfig: AuthConfig;
	createdAt: Date;
}

interface SSOProvider {
	id: string;
	issuer: string;
	domain: string;
	providerId: string;
	domainVerified: boolean | null;
	createdAt: Date | null;
}

interface DomainsAndBrandingTabsProps {
	initialDomains: Domain[];
	initialBranding: OrganizationBranding;
	initialProviders: SSOProvider[];
	initialSocialOAuthConfigs: SocialOAuthConfigResponse[];
	organizationId: string;
}

export function DomainsAndBrandingTabs({
	initialDomains,
	initialBranding,
	initialProviders,
	initialSocialOAuthConfigs,
	organizationId,
}: DomainsAndBrandingTabsProps) {
	const { t } = useTranslate();

	return (
		<Tabs defaultValue="domains" className="space-y-4">
			<TabsList>
				<TabsTrigger value="domains">
					{t("settings.enterprise.tab.domains", "Custom Domain")}
				</TabsTrigger>
				<TabsTrigger value="branding">
					{t("settings.enterprise.tab.branding", "Branding")}
				</TabsTrigger>
				<TabsTrigger value="sso">{t("settings.enterprise.tab.sso", "SSO Providers")}</TabsTrigger>
				<TabsTrigger value="social-oauth">
					{t("settings.enterprise.tab.social-oauth", "Social Login")}
				</TabsTrigger>
			</TabsList>

			<TabsContent value="domains" className="space-y-4">
				<DomainManagement initialDomains={initialDomains} />
			</TabsContent>

			<TabsContent value="branding" className="space-y-4">
				<BrandingForm initialBranding={initialBranding} organizationId={organizationId} />
			</TabsContent>

			<TabsContent value="sso" className="space-y-4">
				<SSOProviderManagement initialProviders={initialProviders} />
			</TabsContent>

			<TabsContent value="social-oauth" className="space-y-4">
				<SocialOAuthManagement initialConfigs={initialSocialOAuthConfigs} />
			</TabsContent>
		</Tabs>
	);
}
