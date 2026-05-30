import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ProjectReportsContainer } from "@/components/reports/projects/project-reports-container";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployeeProjectReportAccess } from "./actions";

export default async function ProjectReportsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Auth is checked in layout
	const [t, access] = await Promise.all([getTranslate(), getCurrentEmployeeProjectReportAccess()]);

	if (!access) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("reports.projects.page.feature", "view project reports")} />
			</div>
		);
	}

	if (!access.canViewProjectReports) {
		return (
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
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">
					{t("reports.projects.page.title", "Project Reports")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"reports.projects.page.description",
						"Analyze project hours, budget usage, and team contributions",
					)}
				</p>
			</div>

			{/* Reports Container */}
			<ProjectReportsContainer />
		</div>
	);
}
