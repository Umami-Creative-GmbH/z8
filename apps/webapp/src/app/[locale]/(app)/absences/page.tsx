import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceCalendar } from "@/components/absences/absence-calendar";
import { AbsenceEntriesTable } from "@/components/absences/absence-entries-table";
import { RequestAbsenceDialog } from "@/components/absences/request-absence-dialog";
import { VacationBalanceCard } from "@/components/absences/vacation-balance-card";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import {
	getAbsenceCategories,
	getAbsenceEntries,
	getCurrentEmployee,
	getHolidays,
	getVacationBalance,
} from "./actions";

export default async function AbsencesPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployee();
	if (!employee) {
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
					<div className="flex flex-1 items-center justify-center p-6">
						<NoEmployeeError feature="manage absences" />
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
	}

	const currentYear = new Date().getFullYear();
	const currentDate = new Date();
	const threeMonthsAgo = new Date(currentDate);
	threeMonthsAgo.setMonth(currentDate.getMonth() - 3);
	const threeMonthsAhead = new Date(currentDate);
	threeMonthsAhead.setMonth(currentDate.getMonth() + 3);

	// Fetch all data in parallel
	const [vacationBalance, absences, holidays, categories] = await Promise.all([
		getVacationBalance(employee.id, currentYear),
		getAbsenceEntries(employee.id, threeMonthsAgo, threeMonthsAhead),
		getHolidays(employee.organizationId, threeMonthsAgo, threeMonthsAhead),
		getAbsenceCategories(employee.organizationId),
	]);

	// If no vacation allowance is set up, show message
	if (!vacationBalance) {
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
					<div className="flex flex-1 items-center justify-center p-6">
						<div className="text-center">
							<h2 className="text-2xl font-semibold mb-2">Vacation Allowance Not Configured</h2>
							<p className="text-muted-foreground">
								Your organization hasn't set up vacation allowances for {currentYear} yet.
								<br />
								Please contact your administrator to configure vacation policies.
							</p>
						</div>
					</div>
				</SidebarInset>
			</SidebarProvider>
		);
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
					<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
						{/* Vacation Balance Card */}
						<div className="px-4 lg:px-6">
							<div className="flex items-center justify-between mb-4">
								<div>
									<h1 className="text-2xl font-semibold">Absences</h1>
									<p className="text-muted-foreground">Manage your time off and vacation days</p>
								</div>
								<RequestAbsenceDialog
									categories={categories}
									remainingDays={vacationBalance.remainingDays}
									trigger={<Button>Request Absence</Button>}
								/>
							</div>
							<VacationBalanceCard balance={vacationBalance} />
						</div>

						{/* Calendar View */}
						<div className="px-4 lg:px-6">
							<AbsenceCalendar absences={absences} holidays={holidays} />
						</div>

						{/* Absences Table */}
						<div className="px-4 lg:px-6">
							<div className="mb-4">
								<h2 className="text-lg font-semibold">Your Absence Requests</h2>
								<p className="text-sm text-muted-foreground">
									Recent and upcoming absence requests
								</p>
							</div>
							<AbsenceEntriesTable absences={absences} />
						</div>
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
