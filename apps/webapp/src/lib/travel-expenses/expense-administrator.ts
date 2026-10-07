import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";

/**
 * The organization expense administrator guard shared by every travel expense
 * settings action (spec #598 review): an organization settings manager of the
 * active organization. Actions that attribute a write to the administrator's
 * employee profile (authorizations, overrides, approvals) require one in that
 * organization.
 */

export const EXPENSE_ADMIN_UNAUTHORIZED = "Unauthorized: Admin access required";

export interface ExpenseAdministrator {
	organizationId: string;
	userId: string;
	/** The administrator's employee profile in the organization, when there is one. */
	employeeId: string | null;
}

export type ExpenseAdministratorAccess<T extends ExpenseAdministrator = ExpenseAdministrator> =
	| { error: string }
	| T;

export async function requireExpenseAdministrator(options: {
	requireEmployee: true;
}): Promise<ExpenseAdministratorAccess<ExpenseAdministrator & { employeeId: string }>>;
export async function requireExpenseAdministrator(options?: {
	requireEmployee?: false;
}): Promise<ExpenseAdministratorAccess>;
export async function requireExpenseAdministrator(
	options: { requireEmployee?: boolean } = {},
): Promise<ExpenseAdministratorAccess> {
	const authContext = await getAuthContext();
	if (!authContext) return { error: EXPENSE_ADMIN_UNAUTHORIZED };
	const organizationId =
		authContext.session.activeOrganizationId ?? authContext.employee?.organizationId ?? null;
	if (!organizationId) return { error: "No organization selected" };
	if (!(await canManageCurrentOrganizationSettings())) return { error: EXPENSE_ADMIN_UNAUTHORIZED };
	const employeeId =
		authContext.employee && authContext.employee.organizationId === organizationId
			? authContext.employee.id
			: null;
	if (options.requireEmployee && !employeeId) {
		return { error: "An employee profile in this organization is required" };
	}
	return { organizationId, userId: authContext.user.id, employeeId };
}
