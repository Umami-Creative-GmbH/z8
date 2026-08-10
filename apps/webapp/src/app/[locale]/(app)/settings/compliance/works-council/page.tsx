import { Suspense } from "react";
import { WorksCouncilSettingsForm } from "@/components/settings/works-council-settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	loadWorksCouncilSettings,
	saveWorksCouncilSettings,
	type WorksCouncilSettingsFormValues,
} from "@/lib/works-council/settings";
import { getTranslate } from "@/tolgee/server";

async function updateWorksCouncilSettings(
	values: WorksCouncilSettingsFormValues,
) {
	"use server";

	const {
		authContext: actionAuthContext,
		organizationId: actionOrganizationId,
	} = await requireOrgAdminSettingsAccess();
	await saveWorksCouncilSettings({
		...values,
		organizationId: actionOrganizationId,
		actorUserId: actionAuthContext.user.id,
	});

	return { success: true };
}

async function WorksCouncilSettingsPageContent() {
	const authContextPromise = requireOrgAdminSettingsAccess();
	const settingsPromise = authContextPromise.then(({ organizationId }) =>
		loadWorksCouncilSettings(organizationId),
	);
	const [settings, t] = await Promise.all([settingsPromise, getTranslate()]);

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

				<WorksCouncilSettingsForm
					initialSettings={settings}
					onSave={updateWorksCouncilSettings}
				/>
			</div>
		</div>
	);
}

function WorksCouncilSettingsPageLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function WorksCouncilSettingsPage() {
	return (
		<Suspense fallback={<WorksCouncilSettingsPageLoading />}>
			<WorksCouncilSettingsPageContent />
		</Suspense>
	);
}
