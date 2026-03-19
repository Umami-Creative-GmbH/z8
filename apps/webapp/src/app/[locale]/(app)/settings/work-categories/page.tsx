import { IconTag } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WorkCategoryManagement } from "@/components/settings/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category-sets-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function WorkCategoriesSettingsContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

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
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="space-y-2">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-96" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function WorkCategoriesSettingsPage() {
	return (
		<Suspense fallback={<WorkCategoriesSettingsLoading />}>
			<WorkCategoriesSettingsContent />
		</Suspense>
	);
}
