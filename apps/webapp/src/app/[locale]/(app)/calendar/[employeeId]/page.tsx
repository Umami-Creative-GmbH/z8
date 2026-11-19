import { Suspense } from "react";
import { CalendarPageHeader } from "@/components/calendar/calendar-page-header";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPageContent } from "../page";

function CalendarPageLoading() {
	return (
		<div
			className="flex flex-1 flex-col"
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
		<div className="page-frame-full flex min-h-0 flex-1 flex-col gap-4">
			<CalendarPageHeader />
			<Suspense fallback={<CalendarPageLoading />}>
				<CalendarEmployeeContent {...props} />
			</Suspense>
		</div>
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
