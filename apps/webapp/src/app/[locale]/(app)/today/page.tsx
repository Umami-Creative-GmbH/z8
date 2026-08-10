import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
import { getCurrentEmployee } from "../team/actions";
import { TodayBriefing } from "./today-briefing";
import { TodayPageLoading } from "./today-loading";

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

export default function TodayPage() {
	return (
		<Suspense fallback={<TodayPageLoading />}>
			<TodayPageContent />
		</Suspense>
	);
}
