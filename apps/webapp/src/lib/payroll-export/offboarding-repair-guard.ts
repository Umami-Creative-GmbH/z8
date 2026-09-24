import type { OpenDepartureClockRepair } from "@/lib/employee-lifecycle/reviews";

/**
 * A departure whose running timer could not be closed safely leaves time that
 * is neither complete nor absent. Payroll exports are all-or-blocked, so such
 * time blocks the export until it is repaired instead of being omitted.
 */
export class PayrollOffboardingRepairBlockedError extends Error {
	constructor(
		readonly organizationId: string,
		readonly employeeIds: readonly string[],
	) {
		super(
			`Payroll export blocked: ${employeeIds.length} employee(s) have an unresolved offboarding clock-out`,
		);
		this.name = "PayrollOffboardingRepairBlockedError";
	}
}

export async function assertNoOpenDepartureClockRepairs(input: {
	organizationId: string;
	employeeIds: readonly string[];
	range: { start: Date; endExclusive: Date };
	findRepairs: (query: {
		organizationId: string;
		employeeIds: readonly string[];
		rangeStart: Date;
		rangeEndExclusive: Date;
	}) => Promise<OpenDepartureClockRepair[]>;
}): Promise<void> {
	const repairs = await input.findRepairs({
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		rangeStart: input.range.start,
		rangeEndExclusive: input.range.endExclusive,
	});
	if (repairs.length === 0) return;
	throw new PayrollOffboardingRepairBlockedError(
		input.organizationId,
		Array.from(new Set(repairs.map((repair) => repair.employeeId))),
	);
}
