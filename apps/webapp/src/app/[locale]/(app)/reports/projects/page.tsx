import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ProjectReportsContainer } from "@/components/reports/projects/project-reports-container";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployeeProjectReportAccess } from "./actions";

async function ProjectReportsPageContent() {
	// Auth is checked in layout
	const [t, access] = await Promise.all([
		getTranslate(),
		getCurrentEmployeeProjectReportAccess(),
	]);
	const header = (
		<PageHeader
			title={t("reports.projects.page.title", "Project Reports")}
			description={t(
				"reports.projects.page.description",
				"Analyze project hours, budget usage, and team contributions",
			)}
		/>
	);

	if (!access) {
		return (
			<>
				{header}
				<div className="@container/main flex flex-1 items-center justify-center p-6">
					<NoEmployeeError
						feature={t("reports.projects.page.feature", "view project reports")}
					/>
				</div>
			</>
		);
	}

	if (!access.canViewProjectReports) {
		return (
			<>
				{header}
				<div className="@container/main flex flex-1 items-center justify-center p-6">
					<div className="text-center">
						<h2 className="text-xl font-semibold">
							{t("reports.projects.page.accessDenied", "Access Denied")}
						</h2>
						<p className="text-muted-foreground mt-2">
							{t(
								"reports.projects.page.noPermission",
								"You don't have permission to view project reports.",
							)}
						</p>
					</div>
				</div>
			</>
		);
	}

	return (
		<>
			{header}
			<ProjectReportsContainer />
		</>
	);
}

function ProjectReportsPageLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.projectReports",
				labelDefault: "Loading project reports",
			}}
			className="@container/main flex flex-1 flex-col gap-6"
			role="status"
		>
			<div className="space-y-3">
				<Skeleton aria-hidden="true" className="h-9 w-64" />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-3xl" />
			</div>
			<Skeleton aria-hidden="true" className="h-96 w-full" />
		</LoadingRegion>
	);
}

// The page frame renders at once; translations and access are request reads
// behind the Suspense boundary.
export default function ProjectReportsPage() {
	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<Suspense fallback={<ProjectReportsPageLoading />}>
				<ProjectReportsPageContent />
			</Suspense>
		</div>
	);
}
