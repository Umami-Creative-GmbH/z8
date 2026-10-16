import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { IdentitySetupWizard } from "@/components/settings/enterprise/identity-setup-wizard";
import { SocialOAuthManagement } from "@/components/settings/enterprise/social-oauth-management";
import { SSOProviderManagement } from "@/components/settings/enterprise/sso-provider-management";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getOrganizationPlatformOrigins } from "@/lib/auth-domain-config";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import {
	getEnterpriseIdentitySetupAction,
	listSocialOAuthConfigsAction,
	listSSOProvidersAction,
} from "../actions";

async function IdentitySettingsContent() {
	const [{ organizationId }, t, setup] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		getEnterpriseIdentitySetupAction(),
	]);

	const [providers, socialOAuthConfigs, organizationRecord] = await Promise.all(
		[
			listSSOProvidersAction(),
			listSocialOAuthConfigsAction(),
			db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
				columns: { id: true, slug: true },
			}),
		],
	);
	const [callbackBaseUrl] = getOrganizationPlatformOrigins({
		id: organizationId,
		slug: organizationRecord?.slug ?? organizationId,
	});
	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.identityAccess.title", "Identity & Access")}
			defaultTab="setup"
			tabs={[
				{
					value: "setup",
					label: t(
						"settings.enterprise.domains.guidedSetup.title",
						"Guided setup",
					),
					description: t(
						"settings.enterpriseIdentitySetup.description",
						"Guide SSO, SCIM provisioning, domain restrictions, invite policy, and default roles for this organization.",
					),
					panel: (
						<IdentitySetupWizard
							initialSetup={setup}
							organizationId={organizationId}
						/>
					),
				},
				{
					value: "sso",
					label: t("settings.enterprise.tab.sso", "SSO Providers"),
					description: t(
						"settings.navigation.identityAccess.ssoDescription",
						"Manage single sign-on providers for your organization",
					),
					panel: (
						<SSOProviderManagement
							initialProviders={providers}
							callbackBaseUrl={callbackBaseUrl}
						/>
					),
				},
				{
					value: "social-oauth",
					label: t("settings.enterprise.tab.social-oauth", "Social Login"),
					description: t(
						"settings.navigation.identityAccess.socialDescription",
						"Configure the social login providers available to your organization",
					),
					panel: (
						<SocialOAuthManagement
							initialConfigs={socialOAuthConfigs}
							callbackBaseUrl={callbackBaseUrl}
						/>
					),
				},
			]}
		/>
	);
}
export default function EnterpriseIdentitySetupPage() {
	return (
		<Suspense
			fallback={
				<SettingsPageSkeleton
					label={{
						labelKey: "settings.loading",
						labelDefault: "Loading settings",
					}}
				/>
			}
		>
			<IdentitySettingsContent />
		</Suspense>
	);
}
