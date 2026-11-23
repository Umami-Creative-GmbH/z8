import { IconBriefcase, IconCar, IconReport } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/navigation";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployeeProjectReportAccess } from "./projects/actions";
import { ReportsTabs } from "./reports-tabs";

export async function ReportsNavTabs() {
	const [t, projectAccess] = await Promise.all([
		getTranslate(),
		getCurrentEmployeeProjectReportAccess(),
	]);
	const showProjectsTab = Boolean(
		projectAccess?.projectsEnabled && projectAccess.canViewProjectReports,
	);

	return (
		<div>
			<ReportsTabs>
				<TabsList
					aria-label={t("nav.reports", "Reports")}
					className="h-auto max-w-full flex-wrap justify-start gap-1"
				>
					<TabsTrigger value="time-and-absences" asChild>
						<Link href="/reports">
							<IconReport className="mr-2 size-4" aria-hidden="true" />
							{t("reports.tabs.timeAndAbsences", "Time & Absences")}
						</Link>
					</TabsTrigger>
					{showProjectsTab ? (
						<TabsTrigger value="projects" asChild>
							<Link href="/reports/projects">
								<IconBriefcase className="mr-2 size-4" aria-hidden="true" />
								{t("reports.tabs.projects", "Projects")}
							</Link>
						</TabsTrigger>
					) : null}
					<TabsTrigger value="vehicles" asChild>
						<Link href="/reports/vehicles">
							<IconCar className="mr-2 size-4" aria-hidden="true" />
							{t("reports.tabs.vehicles", "Vehicles")}
						</Link>
					</TabsTrigger>
				</TabsList>
			</ReportsTabs>
		</div>
	);
}

export default function ReportsLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/reports" params={params}>
			<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
				<Suspense fallback={<Skeleton aria-hidden="true" className="h-10 w-full max-w-md" />}>
					<ReportsNavTabs />
				</Suspense>
				{children}
			</div>
		</RouteTranslationBoundary>
	);
}
