import { connection } from "next/server";
import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";

export async function CalendarPageContent({
	selectedEmployeeId,
}: { selectedEmployeeId?: string } = {}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

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
			initialSelectedEmployeeId={selectedEmployeeId}
		/>
	);
}

function CalendarPageLoading() {
	return (
		<div className="flex flex-1 flex-col p-4">
			<div className="space-y-4">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[560px] w-full" />
			</div>
		</div>
	);
}

export default function CalendarPage() {
	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarPageContent />
		</Suspense>
	);
}
