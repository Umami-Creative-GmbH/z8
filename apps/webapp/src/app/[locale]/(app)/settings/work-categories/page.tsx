import { IconTag } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { WorkCategoryManagement } from "@/components/settings/work-category/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category/work-category-sets-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function WorkCategoriesSettingsContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const { accessTier } = settingsRouteContext;

	return (
		<WorkCategoryManagement organizationId={organizationId} canManage={accessTier === "orgAdmin"}>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconTag className="size-5" />
							Category Sets
						</CardTitle>
						<CardDescription>
							Create category sets with different time factors for various work types
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
	return <SettingsPageSkeleton variant="list" label="Loading work category settings" />;
}

export default function WorkCategoriesSettingsPage() {
	return (
		<Suspense fallback={<WorkCategoriesSettingsLoading />}>
			<WorkCategoriesSettingsContent />
		</Suspense>
	);
}
