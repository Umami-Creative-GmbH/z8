import { revalidatePath } from "next/cache";

/**
 * Revalidates the pages that show the employees' work balances and balance
 * adjustments (#993, #995, #999): their settings page, their page in the
 * payroll area, and the team list.
 */
export function revalidateWorkBalancePaths(employeeIds: Iterable<string>): void {
	for (const employeeId of new Set(employeeIds)) {
		revalidatePath(`/settings/employees/${employeeId}`);
		revalidatePath(`/payroll/work-balances/${employeeId}`);
	}
	revalidatePath("/team");
}
