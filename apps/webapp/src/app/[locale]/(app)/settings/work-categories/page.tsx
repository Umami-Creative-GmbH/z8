import { IconTag } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { WorkCategoryManagement } from "@/components/settings/work-category-management";
import { WorkCategorySetsTable } from "@/components/settings/work-category-sets-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";

async function WorkCategoriesSettingsContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Parallelize employee and auth context fetches
	const [currentEmployee, authContext] = await Promise.all([
		getCurrentEmployee(),
		getAuthContext(),
	]);

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage work categories" />
			</div>
		);
	}

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	return (
		<WorkCategoryManagement organizationId={authContext.employee.organizationId}>
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
						<WorkCategorySetsTable organizationId={authContext.employee.organizationId} />
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
