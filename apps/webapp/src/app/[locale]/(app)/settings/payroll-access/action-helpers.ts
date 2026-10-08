import { AuthenticationError, AuthorizationError } from "@/lib/effect/errors";

export interface PayrollOfficerSettingsContextInput {
	userId?: string;
	employeeOrganizationId: string | null;
	activeOrganizationId: string | null;
	canManagePayrollOfficerSettings: boolean;
}

export function assertPayrollOfficerSettingsContext(
	context: PayrollOfficerSettingsContextInput,
	action: "read" | "write",
): void {
	if (!context.activeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required", userId: context.userId });
	}

	if (
		context.employeeOrganizationId !== null &&
		context.employeeOrganizationId !== context.activeOrganizationId
	) {
		throw new AuthorizationError({
			message: "Active organization employee context is required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
			action,
		});
	}

	if (!context.canManagePayrollOfficerSettings) {
		throw new AuthorizationError({
			message: "Payroll officer settings access required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
			action,
		});
	}
}
