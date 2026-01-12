import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { getActiveWorkPeriod, getCurrentEmployee, getTimeSummary, getWorkPeriods } from "./actions";

export default async function TimeTrackingPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployee();

	if (!employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="track time" />
			</div>
		);
	}

	// Get user's timezone for timezone-aware calculations
	const timezone = await getCurrentTimezone();

	// Use timezone-aware week range so work periods are fetched for the employee's local week
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;
	const [activeWorkPeriod, workPeriods, summary] = await Promise.all([
		getActiveWorkPeriod(employee.id),
		getWorkPeriods(employee.id, startDate, endDate),
		getTimeSummary(employee.id, timezone),
	]);

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Clock In/Out Widget */}
			<div className="px-4 lg:px-6">
				<ClockInOutWidget
					activeWorkPeriod={activeWorkPeriod}
					employeeName={session.user.name || "Employee"}
				/>
			</div>

			{/* Summary Cards */}
			<WeeklySummaryCards summary={summary} />

			{/* Time Entries Table */}
			<div className="px-4 lg:px-6">
				<TimeEntriesTable
					workPeriods={workPeriods}
					hasManager={!!employee.managerId}
					employeeTimezone={timezone}
				/>
			</div>
		</div>
	);
}
