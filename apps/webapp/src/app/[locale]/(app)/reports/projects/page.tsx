import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ProjectReportsContainer } from "@/components/reports/projects/project-reports-container";
import { auth } from "@/lib/auth";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployeeForReports } from "./actions";

export default async function ProjectReportsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployeeForReports();

	if (!employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("reports.projects.page.feature", "view project reports")} />
			</div>
		);
	}

	// Only admins and managers can view project reports
	if (employee.role !== "admin" && employee.role !== "manager") {
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
