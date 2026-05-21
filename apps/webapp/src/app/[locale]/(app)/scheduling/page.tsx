import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getTranslate } from "@/tolgee/server";

async function SchedulingPageContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Auth is checked in layout - session is guaranteed to exist
	const [session, t] = await Promise.all([
		auth.api.getSession({ headers: await headers() }),
		getTranslate(),
	]);
	const currentSession = session!;

	// Get current employee
	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, currentSession.user.id),
	});

	if (!emp) {
		redirect("/onboarding/welcome");
	}

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
					employeeId={emp.id}
					isManager={isManager}
				/>
			</div>
		</div>
	);
}

function SchedulingPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-2 p-4">
			<div className="space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[520px] w-full" />
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
