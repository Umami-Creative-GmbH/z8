import { CalendarView } from "@/components/calendar/calendar-view";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function CalendarPage() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
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
						<NoEmployeeError feature="view the calendar" />
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
					<CalendarView
						organizationId={authContext.employee.organizationId}
						currentEmployeeId={authContext.employee.id}
					/>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
