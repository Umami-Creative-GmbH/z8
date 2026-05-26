import { connection } from "next/server";
import { Suspense } from "react";
import { EmailConfigForm } from "@/components/settings/enterprise/email-config-form";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getEmailConfig, getVaultConnectionStatus } from "./actions";

async function EmailConfigContent() {
	await connection();

	const authContextPromise = requireOrgAdminSettingsAccess();
	const emailConfigPromise = authContextPromise.then(({ organizationId }) =>
		getEmailConfig(organizationId),
	);
	const vaultStatusPromise = authContextPromise.then(() => getVaultConnectionStatus());
	const [{ organizationId }, t, emailConfig, vaultStatus] = await Promise.all([
		authContextPromise,
		getTranslate(),
		emailConfigPromise,
		vaultStatusPromise,
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">
						{t("settings.enterprise.email.title", "Email Configuration")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.enterprise.email.description",
							"Configure a custom email provider for your organization. All organization emails will use this configuration instead of the system default.",
						)}
					</p>
				</div>
				<EmailConfigForm
					organizationId={organizationId}
					initialConfig={emailConfig}
					vaultStatus={vaultStatus}
				/>
			</div>
		</div>
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
