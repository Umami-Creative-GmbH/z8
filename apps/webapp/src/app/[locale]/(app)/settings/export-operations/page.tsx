import { connection } from "next/server";
import { Suspense } from "react";

import { ExportOperationsDashboard } from "@/components/settings/export-operations/export-operations-dashboard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getExportOperationsCockpit } from "@/lib/export-operations/get-export-operations-cockpit";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Export Operations",
	description: "Monitor payroll, audit, and scheduled export activity for your organization.",
};

async function ExportOperationsPageContent() {
	await connection();

	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);
	const data = await getExportOperationsCockpit(organizationId);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.exportOperations.title", "Export Operations")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.exportOperations.description",
						"Monitor payroll, audit, and scheduled export activity for your organization.",
					)}
				</p>
			</div>
			<ExportOperationsDashboard t={t} data={data} />
		</div>
	);
}

function ExportOperationsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-[32rem] max-w-full" />
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }).map((_, index) => (
					<Card key={index}>
						<CardHeader>
							<Skeleton className="h-4 w-28" />
							<Skeleton className="h-5 w-36" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-24" />
						</CardContent>
					</Card>
				))}
			</div>
			<div className="grid gap-6 xl:grid-cols-2">
				{Array.from({ length: 2 }).map((_, index) => (
					<Card key={index}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-72" />
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-40" />
					<Skeleton className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function ExportOperationsPage() {
	return (
		<Suspense fallback={<ExportOperationsPageLoading />}>
			<ExportOperationsPageContent />
		</Suspense>
	);
}
