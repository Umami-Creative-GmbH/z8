import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { WorkCategoryManagement } from "@/components/settings/work-category/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category/work-category-sets-table";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function WorkCategoriesSettingsContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const { accessTier } = settingsRouteContext;

	return (
		<WorkCategoryManagement organizationId={organizationId} canManage={accessTier === "orgAdmin"}>
			<WorkCategorySetsTable
				organizationId={organizationId}
				canManage={accessTier === "orgAdmin"}
			/>
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
