import { IdentitySetupWizard } from "@/components/settings/enterprise/identity-setup-wizard";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getEnterpriseIdentitySetupAction } from "../actions";

export default async function EnterpriseIdentitySetupPage() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const setup = await getEnterpriseIdentitySetupAction();

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold">
						{t("settings.enterpriseIdentitySetup.title", "Enterprise Identity Setup")}
					</h1>
					<p className="max-w-3xl text-muted-foreground">
						{t(
							"settings.enterpriseIdentitySetup.description",
							"Guide SSO, SCIM provisioning, domain restrictions, invite policy, and default roles for this organization.",
						)}
					</p>
				</div>

				<IdentitySetupWizard initialSetup={setup} organizationId={organizationId} />
			</div>
		</div>
	);
}
