import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ShiftTemplateManagement } from "@/components/settings/shift-template-management";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export default async function ShiftTemplatesPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Auth is checked in layout - session is guaranteed to exist
	const session = (await auth.api.getSession({ headers: await headers() }))!;

	// Parallelize independent queries to eliminate waterfall
	const [emp, membership] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		}),
		db.query.member.findFirst({
			where: eq(member.userId, session.user.id),
		}),
	]);

	if (!emp) {
		return <NoEmployeeError />;
	}

	const isAdmin = membership?.role === "admin" || membership?.role === "owner";

	if (!isAdmin) {
		redirect("/settings");
	}

	return <ShiftTemplateManagement organizationId={emp.organizationId} />;
}
