import { CalendarView } from "@/components/calendar/calendar-view";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function CalendarPage() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view the calendar" />
			</div>
		);
	}

	return (
		<CalendarView
			organizationId={authContext.employee.organizationId}
			currentEmployeeId={authContext.employee.id}
		/>
	);
}
