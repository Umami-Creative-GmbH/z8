import type { Metadata } from "next";
import { Suspense } from "react";

import { ExportOperationsDashboard } from "@/components/settings/export-operations/export-operations-dashboard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getExportOperationsCockpit } from "@/lib/export-operations/get-export-operations-cockpit";
import { getTranslate } from "@/tolgee/server";

const EXPORT_SUMMARY_LOADING_KEYS = [
	"payroll",
	"audit",
	"scheduled",
	"storage",
] as const;
const EXPORT_DETAIL_LOADING_KEYS = ["failures", "destinations"] as const;

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("settings.exportOperations.title", "Export Operations"),
		description: t(
			"settings.exportOperations.description",
			"Monitor payroll, audit, and scheduled export activity for your organization.",
		),
	};
}

async function ExportOperationsPageContent() {
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
		<div
			className="flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
			aria-label="Loading export operations"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-[32rem] max-w-full" />
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{EXPORT_SUMMARY_LOADING_KEYS.map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton aria-hidden="true" className="h-4 w-28" />
							<Skeleton aria-hidden="true" className="h-5 w-36" />
						</CardHeader>
						<CardContent>
							<Skeleton aria-hidden="true" className="h-8 w-24" />
						</CardContent>
					</Card>
				))}
			</div>
			<div className="grid gap-6 xl:grid-cols-2">
				{EXPORT_DETAIL_LOADING_KEYS.map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton aria-hidden="true" className="h-6 w-40" />
							<Skeleton aria-hidden="true" className="h-4 w-72" />
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								<Skeleton aria-hidden="true" className="h-10 w-full" />
								<Skeleton aria-hidden="true" className="h-10 w-full" />
							</div>
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton aria-hidden="true" className="h-6 w-40" />
					<Skeleton aria-hidden="true" className="h-4 w-72" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<Skeleton aria-hidden="true" className="h-10 w-full" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
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
