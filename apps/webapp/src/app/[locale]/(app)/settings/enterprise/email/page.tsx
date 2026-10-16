import { Suspense } from "react";
import { EmailTemplateSettingsClient } from "@/components/settings/email-templates/email-template-settings-client";
import { EmailConfigForm } from "@/components/settings/enterprise/email-config-form";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { listEmailTemplates } from "../../email-templates/actions";
import { getEmailConfig, getSecretStoreConnectionStatus } from "./actions";

async function EmailConfigContent() {
	const authContextPromise = requireOrgAdminSettingsAccess();
	const emailConfigPromise = authContextPromise.then(({ organizationId }) =>
		getEmailConfig(organizationId),
	);
	const secretStoreStatusPromise = authContextPromise.then(
		({ organizationId }) => getSecretStoreConnectionStatus(organizationId),
	);
	const [{ organizationId }, t, emailConfig, secretStoreStatus, templates] =
		await Promise.all([
			authContextPromise,
			getTranslate(),
			emailConfigPromise,
			secretStoreStatusPromise,
			authContextPromise.then(() => listEmailTemplates()),
		]);

	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.email.title", "Email")}
			defaultTab="delivery"
			tabs={[
				{
					value: "delivery",
					label: t("settings.navigation.email.delivery", "Delivery"),
					description: t(
						"settings.enterprise.email.description",
						"Configure a custom email provider for your organization. All organization emails will use this configuration instead of the system default.",
					),
					panel: (
						<EmailConfigForm
							organizationId={organizationId}
							initialConfig={emailConfig}
							secretStoreStatus={secretStoreStatus}
						/>
					),
				},
				{
					value: "templates",
					label: t("settings.emailTemplates.title", "Email Templates"),
					description: t(
						"settings.emailTemplates.description",
						"Customize the emails your organization sends",
					),
					panel: (
						<EmailTemplateSettingsClient
							templates={templates.map(({ override, ...definition }) => ({
								definition,
								override,
							}))}
						/>
					),
				},
			]}
		/>
	);
}

function EmailConfigLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-[380px] w-full" />
			</div>
		</div>
	);
}

export default function EmailConfigPage() {
	return (
		<Suspense fallback={<EmailConfigLoading />}>
			<EmailConfigContent />
		</Suspense>
	);
}
