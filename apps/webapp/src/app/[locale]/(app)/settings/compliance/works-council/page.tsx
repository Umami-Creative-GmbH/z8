import { Suspense } from "react";
import { WorksCouncilSettingsForm } from "@/components/settings/works-council-settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";
import { getTranslate } from "@/tolgee/server";
import { updateWorksCouncilSettings } from "./actions";
import { loadWorksCouncilScopeOptions } from "./scope-options";

async function WorksCouncilSettingsPageContent() {
	const authContextPromise = requireOrgAdminSettingsAccess();
	const settingsPromise = authContextPromise.then(({ organizationId }) =>
		loadWorksCouncilSettings(organizationId),
	);
	const scopeOptionsPromise = authContextPromise.then(({ organizationId }) =>
		loadWorksCouncilScopeOptions(organizationId),
	);
	const [settings, scopeOptions, t] = await Promise.all([
		settingsPromise,
		scopeOptionsPromise,
		getTranslate(),
	]);

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.worksCouncil.title", "Works Council Mode")}
					description={t(
						"settings.worksCouncil.description",
						"Configure privacy-safe Betriebsrat access and review exports",
					)}
				/>

				<WorksCouncilSettingsForm
					initialSettings={settings}
					scopeOptions={scopeOptions}
					onSave={updateWorksCouncilSettings}
				/>
			</div>
		</div>
	);
}

function WorksCouncilSettingsPageLoading() {
	return (
		<div className="page-frame" aria-busy="true">
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" aria-hidden="true" />
					<Skeleton className="h-5 w-full max-w-xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-[30rem] w-full" aria-hidden="true" />
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
