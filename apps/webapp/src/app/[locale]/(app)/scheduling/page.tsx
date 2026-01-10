import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export default async function SchedulingPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	// Get current employee
	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
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
						<h1 className="text-2xl font-bold tracking-tight">Shift Schedule</h1>
						<p className="text-muted-foreground">
							{isManager
								? "Manage and plan employee shifts"
								: "View your shifts and pick up available shifts"}
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
