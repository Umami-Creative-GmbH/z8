import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
import { getCurrentEmployee } from "../team/actions";
import { TodayBriefing } from "./today-briefing";

async function TodayPageContent() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view today's briefing" />
			</div>
		);
	}

	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	if (!currentEmployee.organizationId) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view today's briefing" />
			</div>
		);
	}

	const briefing = await getManagerDailyBriefing({
		currentEmployee: {
			id: currentEmployee.id,
			role: currentEmployee.role,
			organizationId: currentEmployee.organizationId,
		},
	});

	return <TodayBriefing briefing={briefing} />;
}

function TodayPageLoading() {
	return (
		<div
			aria-label="Loading today's manager briefing"
			className="@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6"
			role="status"
		>
			<div className="space-y-3">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{["summary", "coverage", "approvals", "exceptions"].map((key) => (
					<Skeleton aria-hidden="true" key={key} className="h-32 w-full" />
				))}
			</div>
			<Skeleton aria-hidden="true" className="h-[420px] w-full" />
		</div>
	);
}

export default function TodayPage() {
	return (
		<Suspense fallback={<TodayPageLoading />}>
			<TodayPageContent />
		</Suspense>
	);
}
