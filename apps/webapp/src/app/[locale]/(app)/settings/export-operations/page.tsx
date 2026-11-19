import type { Metadata } from "next";
import { Suspense } from "react";
import { ExportOperationsDashboard } from "@/components/settings/export-operations/export-operations-dashboard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
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
		<div className="page-frame flex flex-1 flex-col gap-6">
			<PageHeader
				title={t("settings.exportOperations.title", "Export Operations")}
				description={t(
					"settings.exportOperations.description",
					"Monitor payroll, audit, and scheduled export activity for your organization.",
				)}
			/>
			<ExportOperationsDashboard t={t} data={data} />
		</div>
	);
}

function ExportOperationsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.exportOperations",
				labelDefault: "Loading export operations",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-[32rem] max-w-full" />
			</div>
			<div className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-2 xl:grid-cols-4">
				{EXPORT_SUMMARY_LOADING_KEYS.map((key) => (
					<div key={key} className="space-y-2 bg-card p-4">
						<Skeleton aria-hidden="true" className="h-4 w-28" />
						<Skeleton aria-hidden="true" className="h-8 w-24" />
						<Skeleton aria-hidden="true" className="h-3 w-40 max-w-full" />
					</div>
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
		</LoadingRegion>
	);
}

export default function ExportOperationsPage() {
	return (
		<Suspense fallback={<ExportOperationsPageLoading />}>
			<ExportOperationsPageContent />
		</Suspense>
	);
}
