import { connection } from "next/server";
import { Suspense } from "react";
import { getTranslate } from "@/tolgee/server";
import { DemoDataWizard } from "@/components/settings/demo-data-wizard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getOrganizationEmployees } from "./actions";

async function DemoSettingsContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode
	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	// Get employees for the multi-select
	const employeesResult = await getOrganizationEmployees(organizationId);
	const employees = employeesResult.success ? employeesResult.data : [];

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">{t("settings.demo.title", "Demo Data")}</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.demo.description",
						"Generate sample data for testing or clear existing time-related data",
					)}
				</p>
			</div>

			<DemoDataWizard
				key={organizationId}
				organizationId={organizationId}
				employees={employees}
			/>
		</div>
	);
}

function DemoSettingsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton className="h-32 w-full" />
						<Skeleton className="h-10 w-32" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function DemoSettingsPage() {
	return (
		<Suspense fallback={<DemoSettingsLoading />}>
			<DemoSettingsContent />
		</Suspense>
	);
}
