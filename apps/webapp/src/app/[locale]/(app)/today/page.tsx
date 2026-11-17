import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { PageHeader } from "@/components/ui/page-header";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "../team/actions";
import { readTodayBriefing } from "./actions";
import { TodayPageLoading } from "./today-loading";
import { TodayWorkspace } from "./today-workspace";

async function TodayPageContent() {
	const [currentEmployee, t] = await Promise.all([getCurrentEmployee(), getTranslate()]);

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-6">
				<PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />
				<NoEmployeeError feature="view today's briefing" />
			</div>
		);
	}

	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		return redirectWithLocale("/");
	}

	if (!currentEmployee.organizationId) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-6">
				<PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />
				<NoEmployeeError feature="view today's briefing" />
			</div>
		);
	}

	const scope = { userId: currentEmployee.userId, organizationId: currentEmployee.organizationId };
	const initial = await readTodayBriefing(scope);
	return (
		<TodayWorkspace
			scope={scope}
			initial={initial}
			initialEmployee={{ id: currentEmployee.id, role: currentEmployee.role }}
		/>
	);
}

export default function TodayPage() {
	return (
		<Suspense fallback={<TodayPageLoading />}>
			<TodayPageContent />
		</Suspense>
	);
}
