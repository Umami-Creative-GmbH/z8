import { IconTag } from "@tabler/icons-react";
import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { WorkCategoryManagement } from "@/components/settings/work-category/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category/work-category-sets-table";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";

async function WorkCategoriesSettingsContent() {
	const [t, settingsRouteContext] = await Promise.all([
		getTranslate(),
		getCurrentSettingsRouteContext(),
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const { accessTier } = settingsRouteContext;

	return (
		<WorkCategoryManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconTag className="size-5" />
							{t("settings.workCategories.tab.sets", "Category Sets")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.workCategories.createCategorySetsWithDifferentTimeFactorsForVariousWorkTypes",
								"Create category sets with different time factors for various work types",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<WorkCategorySetsTable
							organizationId={organizationId}
							canManage={accessTier === "orgAdmin"}
						/>
					</CardContent>
				</Card>
			</div>
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
