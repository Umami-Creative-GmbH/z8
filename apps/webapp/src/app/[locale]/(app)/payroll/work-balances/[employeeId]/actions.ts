"use server";

import {
	type EmployeeWorkBalanceSectionData,
	getEmployeeWorkBalanceSectionAction,
} from "@/app/[locale]/(app)/settings/employees/work-balance-actions";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import type { BalanceAdjustmentActionResult } from "@/lib/work-balance/adjustments/types";
import { loadPayrollWorkBalanceEmployees } from "../coverage";

/** Recheck this route's payroll admission on refresh; settings/manager access is independent. */
export async function getPayrollEmployeeBalanceAction(input: {
	employeeId: string;
}): Promise<BalanceAdjustmentActionResult<EmployeeWorkBalanceSectionData>> {
	try {
		if (
			!isCanonicalUuid(input.employeeId) ||
			!(await loadPayrollWorkBalanceEmployees(input.employeeId))?.length
		)
			return { success: false, code: "AuthorizationError", error: "Work balance unavailable" };
		return await getEmployeeWorkBalanceSectionAction(input);
	} catch {
		return { success: false, code: "DatabaseError", error: "Work balance unavailable" };
	}
}
