import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { WorkCategoryManagement } from "@/components/settings/work-category/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category/work-category-sets-table";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

async function WorkCategoriesSettingsContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	const { organizationId, settingsAccess } = caller;
	const canManage = meetsSettingsAccess(settingsAccess, "orgAdmin");

	return (
		<WorkCategoryManagement organizationId={organizationId} canManage={canManage}>
			<WorkCategorySetsTable organizationId={organizationId} canManage={canManage} />
		</WorkCategoryManagement>
	);
}

function WorkCategoriesSettingsLoading() {
	return (
		<SettingsPageSkeleton
			variant="list"
			label={{
				labelKey: "common.loadingRegions.workCategorySettings",
				labelDefault: "Loading work category settings",
			}}
		/>
	);
}

export default function WorkCategoriesSettingsPage() {
	return (
		<Suspense fallback={<WorkCategoriesSettingsLoading />}>
			<WorkCategoriesSettingsContent />
		</Suspense>
	);
}
