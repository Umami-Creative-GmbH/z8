import { Suspense } from "react";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { parseSchedulerFocus } from "@/components/scheduling/scheduler/shift-scheduler-utils";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import SchedulingPageLoading from "./loading";

type SchedulingSearchParams = {
	employeeId?: string | string[];
	date?: string | string[];
};

type SchedulingPageProps = {
	/** `?employeeId=&date=` opens the schedule on one employee around one date. */
	searchParams?: Promise<SchedulingSearchParams>;
};

function single(value: string | string[] | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

async function SchedulingPageContent({ searchParams }: SchedulingPageProps = {}) {
	const [authContext, t, query] = await Promise.all([
		getAuthContext(),
		getTranslate(),
		searchParams ?? Promise.resolve<SchedulingSearchParams>({}),
	]);

	if (!authContext?.employee) {
		return redirectWithLocale("/onboarding/welcome");
	}

	const emp = authContext.employee;
	const org = await db.query.organization.findFirst({
		where: (table, { eq }) => eq(table.id, emp.organizationId),
		columns: { timezone: true, name: true },
	});

	const isManager = emp.role === "manager" || emp.role === "admin";
	const focus = parseSchedulerFocus({
		employeeId: single(query.employeeId),
		date: single(query.date),
	});

	return (
		<div className="@container/main page-frame-full flex min-w-0 flex-1 flex-col">
			<div className="flex min-w-0 flex-1 flex-col gap-6">
				<PageHeader
					title={
						isManager
							? t("scheduling:scheduling.page.title", "Shift Schedule")
							: t("scheduling:scheduling.page.employeeTitle", "My Schedule")
					}
					scope={
						<span>
							{org?.name} · {org?.timezone ?? "UTC"}
						</span>
					}
					description={
						isManager
							? t(
									"scheduling:scheduling.page.planningDescription",
									"Plan and publish shifts. Planned shifts do not record working time.",
								)
							: t(
									"scheduling:scheduling.page.employeeScheduleDescription",
									"Your published shifts, week by week",
								)
					}
				/>

				<ShiftScheduler
					// A new focus from the URL opens a fresh schedule view.
					key={`${emp.organizationId}:${emp.id}:${emp.role}:${focus.employeeId ?? ""}:${focus.date ?? ""}`}
					organizationId={emp.organizationId}
					organizationTimezone={org?.timezone ?? "UTC"}
					employeeId={emp.id}
					isManager={isManager}
					// Only managers see other employees' shifts to filter by.
					focusEmployeeId={isManager ? focus.employeeId : null}
					focusDate={focus.date}
				/>
			</div>
		</div>
	);
}

export default function SchedulingPage(props: SchedulingPageProps) {
	return (
		<Suspense fallback={<SchedulingPageLoading />}>
			<SchedulingPageContent {...props} />
		</Suspense>
	);
}
