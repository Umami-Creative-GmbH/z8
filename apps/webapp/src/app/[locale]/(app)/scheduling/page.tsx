import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function SchedulingPageContent() {
	const [authContext, t] = await Promise.all([
		getAuthContext(),
		getTranslate(),
	]);

	if (!authContext?.employee) {
		redirect("/onboarding/welcome");
	}

	const emp = authContext.employee;
	const org = await db.query.organization.findFirst({
		where: (table, { eq }) => eq(table.id, emp.organizationId),
		columns: { timezone: true },
	});

	const isManager = emp.role === "manager" || emp.role === "admin";

	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">
							{t("scheduling:scheduling.page.title", "Shift Schedule")}
						</h1>
						<p className="text-muted-foreground">
							{isManager
								? t(
										"scheduling:scheduling.page.managerDescription",
										"Manage and plan employee shifts",
									)
								: t(
										"scheduling:scheduling.page.employeeDescription",
										"View your shifts and pick up available shifts",
									)}
						</p>
					</div>
				</div>

				<ShiftScheduler
					organizationId={emp.organizationId}
					organizationTimezone={org?.timezone ?? "UTC"}
					employeeId={emp.id}
					isManager={isManager}
				/>
			</div>
		</div>
	);
}

function SchedulingPageLoading() {
	return (
		<div
			aria-label="Loading shift schedule"
			className="@container/main flex flex-1 flex-col gap-2"
			role="status"
		>
			<div className="space-y-4 p-4">
				<Skeleton aria-hidden="true" className="h-8 w-56" />
				<Skeleton aria-hidden="true" className="h-5 w-80" />
				<Skeleton aria-hidden="true" className="h-[520px] w-full" />
			</div>
		</div>
	);
}

export default function SchedulingPage() {
	return (
		<Suspense fallback={<SchedulingPageLoading />}>
			<SchedulingPageContent />
		</Suspense>
	);
}
