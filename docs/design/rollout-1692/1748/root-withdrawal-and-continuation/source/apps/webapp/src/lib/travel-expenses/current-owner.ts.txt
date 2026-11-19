import { getAuthContext } from "@/lib/auth-helpers";
import type { ReportOwner } from "./report-store";

/**
 * The signed-in employee as the owner of their own travel expense reports in
 * the active organization, or null without an employee profile there. Every
 * employee travel expense action scopes its reads and writes by it.
 */
export async function currentReportOwner(): Promise<ReportOwner | null> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}
