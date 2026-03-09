import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { getTimeTrackingPageData } from "./page-data";

export default async function TimeTrackingPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const pageData = await getTimeTrackingPageData();

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
				/>
			</div>

			<WeeklySummaryCards summary={pageData.summary} />

			<div className="px-4 lg:px-6">
				<TimeEntriesTable
					workPeriods={pageData.workPeriods}
					hasManager={!!pageData.currentEmployee.managerId}
					employeeTimezone={pageData.timezone}
					employeeId={pageData.currentEmployee.id}
				/>
			</div>
		</div>
	);
}
