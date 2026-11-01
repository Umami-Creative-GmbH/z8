import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import { findPersonnelIdentifierClashes } from "@/lib/payroll-export/personnel-identifier-store";
import {
	loadPayrollSetupChecks,
	type PayrollSetupChecks,
} from "@/lib/payroll-readiness/payroll-setup-checks";
import type { GoLiveAsOf, GoLiveMember } from "./types";

/**
 * A member's payroll prerequisites today, from payroll readiness's setup checks.
 * Invitees have no employment terms or personnel identifier yet, so those are
 * not applicable to them; the organization-wide ones still are.
 */
export type PayrollPrerequisites = {
	/** Whether payroll setup is a launch requirement: the organization has an active payroll export target. */
	mandatory: boolean;
	exportTargetCount: number;
	wageTypeMappings: "present" | "missing";
	employmentTerms: "confirmed" | "missing" | "not-applicable";
	personnelIdentifier:
		| { status: "unique" }
		| { status: "shared"; identifier: string; sharedWith: string[] }
		| { status: "unavailable" }
		| { status: "not-applicable" };
};

/**
 * Payroll readiness's setup checks as of today in the organization's timezone,
 * for the given employees: confirmed terms covering today, and personnel
 * identifier clashes among these employees. Read-only.
 */
export function loadGoLivePayrollSetup(
	db: DatabaseClient,
	input: { organizationId: string; asOf: GoLiveAsOf; employeeIds: readonly string[] },
): Promise<PayrollSetupChecks> {
	// Terms dates are stored as UTC midnight of the calendar date, so today is that UTC day.
	const start = utcMidnight(input.asOf.today);
	const end = new Date(utcMidnight(input.asOf.today.add({ days: 1 })).getTime() - 1);
	return loadPayrollSetupChecks(db, {
		organizationId: input.organizationId,
		employees: input.employeeIds.map((id) => ({ id })),
		termsWindow: { start, end },
		findIdentifierClashes: (configs) =>
			findPersonnelIdentifierClashes(db, {
				organizationId: input.organizationId,
				configs,
				employeeIds: input.employeeIds,
				asOf: input.asOf.today,
			}),
	});
}

/** One member's prerequisites from setup checks loaded for a group they belong to. */
export function payrollPrerequisitesOf(
	setup: PayrollSetupChecks,
	member: GoLiveMember,
): PayrollPrerequisites {
	const organizationWide = {
		mandatory: setup.exportTargetCount > 0,
		exportTargetCount: setup.exportTargetCount,
		wageTypeMappings: setup.wageTypeMappings.status === "pass" ? "present" : "missing",
	} as const;
	if (member.kind === "invitee") {
		return {
			...organizationWide,
			employmentTerms: "not-applicable",
			personnelIdentifier: { status: "not-applicable" },
		};
	}

	const { employeeId } = member;
	const missingTerms = setup.employmentHistory.affectedEmployees.some(
		(employee) => employee.id === employeeId,
	);
	return {
		...organizationWide,
		employmentTerms: missingTerms ? "missing" : "confirmed",
		personnelIdentifier: identifierOf(setup, employeeId),
	};
}

function identifierOf(
	setup: PayrollSetupChecks,
	employeeId: string,
): PayrollPrerequisites["personnelIdentifier"] {
	if (setup.personnelIdentifiers.status === "unavailable") return { status: "unavailable" };
	for (const clash of setup.identifierClashes) {
		const holder = clash.employees.find((candidate) => candidate.employeeId === employeeId);
		if (!holder) continue;
		return {
			status: "shared",
			identifier: holder.identifier,
			sharedWith: clash.employees
				.filter((other) => other.employeeId !== employeeId)
				.map((other) => other.name?.trim() || other.employeeId),
		};
	}
	return { status: "unique" };
}

/**
 * One member's payroll prerequisites today, for the go-live rehearsal. Personnel
 * identifiers are compared among `groupEmployeeIds` (the go-live group's
 * employees), so pass the group to see clashes with other members. Read-only.
 */
export async function readPayrollPrerequisites(
	db: DatabaseClient,
	input: {
		organizationId: string;
		asOf: GoLiveAsOf;
		member: GoLiveMember;
		groupEmployeeIds?: readonly string[];
	},
): Promise<PayrollPrerequisites> {
	const own = input.member.kind === "employee" ? [input.member.employeeId] : [];
	const setup = await loadGoLivePayrollSetup(db, {
		organizationId: input.organizationId,
		asOf: input.asOf,
		employeeIds: [...new Set([...own, ...(input.groupEmployeeIds ?? [])])],
	});
	return payrollPrerequisitesOf(setup, input.member);
}
