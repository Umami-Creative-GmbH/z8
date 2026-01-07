import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import { getWeekRange } from "@/lib/time-tracking/time-utils";
import { getActiveWorkPeriod, getCurrentEmployee, getTimeSummary, getWorkPeriods } from "./actions";

export default async function TimeTrackingPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployee();

	// Fetch data only if employee exists
	let activeWorkPeriod = null;
	let workPeriods = [];
	let summary = null;

	if (employee) {
		const { start, end } = getWeekRange(new Date());
		[activeWorkPeriod, workPeriods, summary] = await Promise.all([
			getActiveWorkPeriod(employee.id),
			getWorkPeriods(employee.id, start, end),
			getTimeSummary(employee.id, new Date()),
		]);
	}

	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<ServerAppSidebar variant="inset" />
			<SidebarInset>
				<SiteHeader />
				<div className="flex flex-1 flex-col">
					{!employee ? (
						<div className="@container/main flex flex-1 items-center justify-center p-6">
							<NoEmployeeError feature="track time" />
						</div>
					) : (
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
								<TimeEntriesTable workPeriods={workPeriods} hasManager={!!employee.managerId} />
							</div>
						</div>
					)}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
