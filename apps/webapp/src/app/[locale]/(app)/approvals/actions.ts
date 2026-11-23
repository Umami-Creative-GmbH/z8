"use server";

import { getCurrentEmployee as getCurrentEmployeeAction } from "@/lib/approvals/server/queries";

/**
 * The active organization's current employee. Shared by the employee select,
 * profile settings and employee queries; the legacy approvals workspace that
 * also lived here was retired for the Approval inbox (#1976).
 */
export async function getCurrentEmployee() {
	return getCurrentEmployeeAction();
}
