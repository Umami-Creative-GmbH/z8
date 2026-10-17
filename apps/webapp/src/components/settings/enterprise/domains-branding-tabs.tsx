"use client";

import { useTranslate } from "@tolgee/react";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import type { AuthConfig, OrganizationBranding } from "@/lib/domain";
import { BrandingForm } from "./branding-form";
import { DomainManagement } from "./domain-management";

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

interface DomainsAndBrandingTabsProps {
	initialDomains: Domain[];
	initialBranding: OrganizationBranding;
	organizationId: string;
	defaultUrls: {
		canonical: string;
	};
}

export function DomainsAndBrandingTabs({
	initialDomains,
	initialBranding,

	organizationId,
	defaultUrls,
}: DomainsAndBrandingTabsProps) {
	const { t } = useTranslate();

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.customDomains.title", "Domain & Branding")}
			defaultTab="domains"
			tabs={[
				{
					value: "domains",
					label: t("settings.enterprise.tab.domains", "Custom Domain"),
					description: t(
						"settings.navigation.domainBranding.description",
						"Configure your organization’s custom domain and branding",
					),
					panel: (
						<DomainManagement
							initialDomains={initialDomains}
							organizationId={organizationId}
							defaultUrls={defaultUrls}
						/>
					),
				},
				{
					value: "branding",
					label: t("settings.enterprise.tab.branding", "Branding"),
					description: t(
						"settings.navigation.domainBranding.description",
						"Configure your organization’s custom domain and branding",
					),
					panel: (
						<BrandingForm
							initialBranding={initialBranding}
							organizationId={organizationId}
						/>
					),
				},
			]}
		/>
	);
}
