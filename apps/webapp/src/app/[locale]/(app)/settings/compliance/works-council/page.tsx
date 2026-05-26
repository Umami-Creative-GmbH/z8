import { connection } from "next/server";
import { WorksCouncilSettingsForm } from "@/components/settings/works-council-settings-form";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	loadWorksCouncilSettings,
	saveWorksCouncilSettings,
	type WorksCouncilSettingsFormValues,
} from "@/lib/works-council/settings";
import { getTranslate } from "@/tolgee/server";

export default async function WorksCouncilSettingsPage() {
	await connection();

	const authContextPromise = requireOrgAdminSettingsAccess();
	const settingsPromise = authContextPromise.then(({ organizationId }) =>
		loadWorksCouncilSettings(organizationId),
	);
	const [settings, t] = await Promise.all([settingsPromise, getTranslate()]);

	async function updateWorksCouncilSettings(values: WorksCouncilSettingsFormValues) {
		"use server";

		const { authContext: actionAuthContext, organizationId: actionOrganizationId } =
			await requireOrgAdminSettingsAccess();
		await saveWorksCouncilSettings({
			...values,
			organizationId: actionOrganizationId,
			actorUserId: actionAuthContext.user.id,
		});

		return { success: true };
	}

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.worksCouncil.title", "Works Council Mode")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.worksCouncil.description",
							"Configure privacy-safe Betriebsrat access and review exports",
						)}
					</p>
				</div>

				<WorksCouncilSettingsForm initialSettings={settings} onSave={updateWorksCouncilSettings} />
			</div>
		</div>
	);
}
