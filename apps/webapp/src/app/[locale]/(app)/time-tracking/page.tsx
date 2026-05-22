import { connection } from "next/server";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { PersonalWorkdayTimeline } from "@/components/time-tracking/personal-workday-timeline";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeTrackingPageSearchParams } from "./page-data";
import { getTimeTrackingPageData } from "./page-data";

interface TimeTrackingPageProps {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}

async function TimeTrackingPageContent({ searchParams }: TimeTrackingPageProps) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const pageData = await getTimeTrackingPageData(await searchParams);

	if (!pageData.currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="track time" />
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<ClockInOutWidget
					activeWorkPeriod={pageData.activeWorkPeriod}
					employeeName={pageData.session.user.name || pageData.t("common.employee", "Employee")}
					timeFormat={pageData.timeFormat}
				/>
			</div>

			<div className="px-4 lg:px-6">
				<PersonalWorkdayTimeline result={pageData.timelineResult} />
			</div>

			<WeeklySummaryCards summary={pageData.summary} workBalance={pageData.workBalance} />

			<div className="px-4 lg:px-6">
				<TimeEntriesTable
					workPeriods={pageData.workPeriods}
					hasManager={pageData.hasManager}
					canApproveTimeEntries={pageData.canApproveTimeEntries}
					employeeTimezone={pageData.timezone}
					timeFormat={pageData.timeFormat}
					employeeId={pageData.currentEmployee.id}
				/>
			</div>
		</div>
	);
}

function TimeTrackingPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<Skeleton className="h-40 w-full" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton className="h-64 w-full" />
			</div>
			<div className="grid gap-4 px-4 md:grid-cols-2 lg:px-6 xl:grid-cols-4">
				{["week", "hours", "breaks", "balance"].map((key) => (
					<Skeleton key={key} className="h-28 w-full" />
				))}
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton className="h-80 w-full" />
			</div>
		</div>
	);
}

export default function TimeTrackingPage(props: TimeTrackingPageProps) {
	return (
		<Suspense fallback={<TimeTrackingPageLoading />}>
			<TimeTrackingPageContent {...props} />
		</Suspense>
	);
}
