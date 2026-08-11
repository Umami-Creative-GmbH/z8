import { Suspense } from "react";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPageContent } from "../page";

function CalendarPageLoading() {
	return (
		<div
			className="flex flex-1 flex-col p-4"
			data-testid="calendar-page-loading"
			role="status"
			aria-busy="true"
		>
			<LocalizedLoadingLabel
				translationKey="common:loading.calendar"
				fallback="Loading calendar"
			/>
			<div className="space-y-4">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[560px] w-full" />
			</div>
		</div>
	);
}

type CalendarEmployeePageProps = {
	params: Promise<{ employeeId: string }>;
	searchParams: Promise<{ date?: string }>;
};

export default function CalendarEmployeePage(props: CalendarEmployeePageProps) {
	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarEmployeeContent {...props} />
		</Suspense>
	);
}

async function CalendarEmployeeContent({
	params,
	searchParams,
}: CalendarEmployeePageProps) {
	const [{ employeeId }, { date }] = await Promise.all([params, searchParams]);

	return (
		<CalendarPageContent requestedDate={date} selectedEmployeeId={employeeId} />
	);
}
