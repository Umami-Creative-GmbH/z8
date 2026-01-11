"use client";

import { useTranslate } from "@tolgee/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OrganizationBranding } from "@/lib/domain";
import { BrandingForm } from "./branding-form";
import { DomainManagement } from "./domain-management";
import { SSOProviderManagement } from "./sso-provider-management";

interface Domain {
	id: string;
	domain: string;
	domainVerified: boolean;
	isPrimary: boolean;
	verificationToken: string | null;
	authConfig: {
		ssoEnabled: boolean;
		passwordEnabled: boolean;
		ssoProvider: string | null;
	};
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
	organizationId: string;
}

export function DomainsAndBrandingTabs({
	initialDomains,
	initialBranding,
	initialProviders,
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
		</Tabs>
	);
}
