"use client";

import { useTranslate } from "@tolgee/react";
import Link from "next/link";
import type { SocialOAuthConfigResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Button } from "@/components/ui/button";
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
	domainVerificationToken: string | null;
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
				<DomainManagement initialDomains={initialDomains} organizationId={organizationId} />
			</TabsContent>

			<TabsContent value="branding" className="space-y-4">
				<BrandingForm initialBranding={initialBranding} organizationId={organizationId} />
			</TabsContent>

			<TabsContent value="sso" className="space-y-4">
				<div className="rounded-lg border bg-muted/30 p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h3 className="font-medium">
								{t("settings.enterprise.domains.guidedSetup.title", "Guided setup")}
							</h3>
							<p className="text-muted-foreground text-sm">
								{t(
									"settings.enterprise.domains.guidedSetup.description",
									"Configure SSO, SCIM, access policy, and activation checks in one guarded flow.",
								)}
							</p>
						</div>
						<Button asChild variant="outline" className="w-fit">
							<Link href="/settings/enterprise/identity-setup">
								{t("settings.enterprise.domains.guidedSetup.action", "Guided setup")}
							</Link>
						</Button>
					</div>
				</div>
				<SSOProviderManagement initialProviders={initialProviders} />
			</TabsContent>

			<TabsContent value="social-oauth" className="space-y-4">
				<SocialOAuthManagement initialConfigs={initialSocialOAuthConfigs} />
			</TabsContent>
		</Tabs>
	);
}
