import { employee } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadEmployeeTime } from "@/lib/engagement/engagement-stints";
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
	/** `external-contractor`: an External Contractor today has no employee payroll (#1997). */
	employmentTerms: "confirmed" | "missing" | "not-applicable" | "external-contractor";
	personnelIdentifier:
		| { status: "unique" }
		| { status: "shared"; identifier: string; sharedWith: string[] }
		| { status: "unavailable" }
		| { status: "not-applicable" }
		| { status: "external-contractor" };
};

/** Payroll readiness's setup checks for go-live, with who has no employee payroll today. */
export type GoLivePayrollSetup = PayrollSetupChecks & {
	/** Employees who are External Contractors today: no terms or identifier are expected (#1997). */
	externalContractors: ReadonlySet<string>;
};

/**
 * Payroll readiness's setup checks as of today in the organization's timezone,
 * for the given employees: confirmed terms covering today, and the personnel
 * identifier clashes they are part of. Identifiers are compared with the whole
 * current roster, since an export merges anyone sharing one, going live yet or
 * not; only clashes involving one of `employeeIds` are kept. External Contractors
 * (today) are left out of both: payroll exports never carry them (#1997). Read-only.
 */
export async function loadGoLivePayrollSetup(
	db: DatabaseClient,
	input: { organizationId: string; asOf: GoLiveAsOf; employeeIds: readonly string[] },
): Promise<GoLivePayrollSetup> {
	const { organizationId, asOf } = input;
	// Terms dates are stored as UTC midnight of the calendar date, so today is that UTC day.
	const start = utcMidnight(asOf.today);
	const end = new Date(utcMidnight(asOf.today.add({ days: 1 })).getTime() - 1);
	const today = asOf.today.toString();
	const employeesToday = async (ids: readonly string[]) =>
		(await loadEmployeeTime(db, organizationId, ids)).withEmployeeTimeOn(ids, today, today);
	const employees = await employeesToday(input.employeeIds);
	const checked = new Set(employees);
	const setup = await loadPayrollSetupChecks(db, {
		organizationId,
		employees: employees.map((id) => ({ id })),
		termsWindow: { start, end },
		findIdentifierClashes: async (configs) => {
			if (configs.length === 0 || checked.size === 0) return [];
			const roster = await db
				.select({ id: employee.id })
				.from(employee)
				.where(onCurrentRoster(organizationId, employee, asOf.instant));
			const clashes = await findPersonnelIdentifierClashes(db, {
				organizationId,
				configs,
				employeeIds: await employeesToday([
					...new Set([...input.employeeIds, ...roster.map((row) => row.id)]),
				]),
				asOf: asOf.today,
			});
			return clashes.filter((clash) =>
				clash.employees.some((holder) => checked.has(holder.employeeId)),
			);
		},
	});
	return {
		...setup,
		externalContractors: new Set(input.employeeIds.filter((id) => !checked.has(id))),
	};
}

/** One member's prerequisites from setup checks loaded for a group they belong to. */
export function payrollPrerequisitesOf(
	setup: GoLivePayrollSetup,
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
	if (setup.externalContractors.has(employeeId)) {
		return {
			...organizationWide,
			employmentTerms: "external-contractor",
			personnelIdentifier: { status: "external-contractor" },
		};
	}
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
 * One member's payroll prerequisites today, for the go-live rehearsal, with
 * personnel identifiers compared with the whole current roster as the payroll
 * setup check compares them. Read-only.
 */
export async function readPayrollPrerequisites(
	db: DatabaseClient,
	input: { organizationId: string; asOf: GoLiveAsOf; member: GoLiveMember },
): Promise<PayrollPrerequisites> {
	const setup = await loadGoLivePayrollSetup(db, {
		organizationId: input.organizationId,
		asOf: input.asOf,
		employeeIds: input.member.kind === "employee" ? [input.member.employeeId] : [],
	});
	return payrollPrerequisitesOf(setup, input.member);
}
