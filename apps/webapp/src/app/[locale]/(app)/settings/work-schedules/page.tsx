import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { WorkScheduleManagement } from "@/components/settings/work-schedule-management";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export default async function WorkSchedulesPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		redirect("/sign-in");
	}

	// Get employee record
	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	if (!emp) {
		return <NoEmployeeError />;
	}

	// Check if user is admin or owner
	const membership = await db.query.member.findFirst({
		where: eq(member.userId, session.user.id),
	});

	const isAdmin = membership?.role === "admin" || membership?.role === "owner";

	if (!isAdmin) {
		redirect("/settings");
	}

	return <WorkScheduleManagement organizationId={emp.organizationId} />;
}
