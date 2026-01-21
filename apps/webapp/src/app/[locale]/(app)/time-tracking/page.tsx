import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { getTranslate } from "@/tolgee/server";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions";

export default async function TimeTrackingPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Auth is checked in layout - session is guaranteed to exist
	const session = (await auth.api.getSession({ headers: await headers() }))!;

	// Parallelize employee and timezone queries - both only need session.user.id
	const [emp, settingsData] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		}),
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, session.user.id),
			columns: { timezone: true },
		}),
	]);

	if (!emp) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="track time" />
			</div>
		);
	}

	const timezone = settingsData?.timezone || "UTC";

	// Use timezone-aware week range so work periods are fetched for the employee's local week
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;
	const [activeWorkPeriod, workPeriods, summary, t] = await Promise.all([
		getActiveWorkPeriod(emp.id),
		getWorkPeriods(emp.id, startDate, endDate),
		getTimeSummary(emp.id, timezone),
		getTranslate(),
	]);

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Clock In/Out Widget */}
			<div className="px-4 lg:px-6">
				<ClockInOutWidget
					activeWorkPeriod={activeWorkPeriod}
					employeeName={session.user.name || t("common.employee", "Employee")}
				/>
			</div>

			{/* Summary Cards */}
			<WeeklySummaryCards summary={summary} />

			{/* Time Entries Table */}
			<div className="px-4 lg:px-6">
				<TimeEntriesTable
					workPeriods={workPeriods}
					hasManager={!!emp.managerId}
					employeeTimezone={timezone}
					employeeId={emp.id}
				/>
			</div>
		</div>
	);
}
