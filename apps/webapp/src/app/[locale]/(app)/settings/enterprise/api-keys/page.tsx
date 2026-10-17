import { Suspense } from "react";
import { ApiKeyPageClient } from "@/components/enterprise/api-key-page-client";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { WebhooksPageClient } from "@/components/webhooks/webhooks-page-client";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getWebhookEndpointsByOrganization } from "@/lib/webhooks";
import { getTranslate } from "@/tolgee/server";
import { listApiKeys } from "./actions";

async function DeveloperSettingsContent() {
	const [{ authContext, organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	// Fetch API keys for the organization
	const [apiKeysResult, webhooks] = await Promise.all([
		listApiKeys(organizationId),
		getWebhookEndpointsByOrganization(organizationId),
	]);
	const apiKeys = apiKeysResult.success ? apiKeysResult.data : [];

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.developerAccess.title", "Developer Access")}
			defaultTab="keys"
			tabs={[
				{
					value: "keys",
					label: t("settings.apiKeys.title", "API Keys"),
					description: t(
						"settings.apiKeys.description",
						"Create and manage API keys for programmatic access to your organization data.",
					),
					panel: (
						<ApiKeyPageClient
							organizationId={organizationId}
							initialApiKeys={apiKeys}
							currentUserId={authContext.user.id}
						/>
					),
				},
				{
					value: "webhooks",
					label: t("settings.webhooks.title", "Webhooks"),
					description: t(
						"settings.webhooks.description",
						"Configure webhook endpoints to receive real-time event notifications",
					),
					panel: (
						<WebhooksPageClient
							organizationId={organizationId}
							webhooks={webhooks}
						/>
					),
				},
			]}
		/>
	);
}
export default function DeveloperSettingsPage() {
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
			<DeveloperSettingsContent />
		</Suspense>
	);
}
