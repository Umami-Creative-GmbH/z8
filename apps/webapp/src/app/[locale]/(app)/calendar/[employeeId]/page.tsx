import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPageContent } from "../page";

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

export default async function CalendarEmployeePage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = await params;

	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarPageContent selectedEmployeeId={employeeId} />
		</Suspense>
	);
}
