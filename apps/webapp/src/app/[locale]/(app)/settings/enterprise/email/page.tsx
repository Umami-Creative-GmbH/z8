import { redirect } from "next/navigation";
import { EmailConfigForm } from "@/components/settings/enterprise/email-config-form";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getEmailConfig, getVaultConnectionStatus } from "./actions";

export default async function EmailConfigPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	// Only admins can access enterprise settings
	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	const organizationId = authContext.employee?.organizationId;
	if (!organizationId) {
		redirect("/settings");
	}

	// Fetch email config and vault status in parallel
	const [emailConfig, vaultStatus] = await Promise.all([
		getEmailConfig(organizationId),
		getVaultConnectionStatus(),
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
