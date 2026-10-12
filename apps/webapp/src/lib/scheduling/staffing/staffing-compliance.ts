import type { PlainDate } from "@/lib/datetime/temporal-core";
import {
	buildEmployeeComplianceInput,
	type ComplianceShiftSource,
	type ComplianceWorkPeriodSource,
} from "@/lib/scheduling/compliance/employee-compliance-input";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";
import type {
	ComplianceFinding,
	ScheduleComplianceRegulation,
	ScheduleComplianceWindow,
} from "@/lib/scheduling/compliance/types";

/**
 * Days judged around a hypothetical shift: its own day (daily totals, rest before it) and the
 * two after it (rest after a shift that runs past midnight). Weekly and monthly periods that
 * overlap these days are judged on every loaded day.
 */
const JUDGED_DAYS = 3;

/** Identifies a finding across the two evaluations, ignoring totals that the shift changes. */
function findingKey(finding: ComplianceFinding): string {
	switch (finding.type) {
		case "restTime":
			return `restTime|${finding.fromEndIso}|${finding.toStartIso}`;
		case "maxHours":
			return `maxHours|${finding.day}`;
		case "overtime":
			return `overtime|${finding.period}|${finding.periodKey}`;
	}
}

/**
 * The compliance findings that assigning `hypothetical` to the employee would add under
 * `regulation`, the employee's own: findings present without the shift are left out. `shifts`
 * and `workPeriods` are the employee's planned shifts and completed work around the shift date,
 * including the lookback that weekly and monthly totals need.
 */
export function addedComplianceFindings(input: {
	employeeId: string;
	timezone: string;
	shiftDate: PlainDate;
	regulation: ScheduleComplianceRegulation;
	shifts: readonly ComplianceShiftSource[];
	workPeriods: readonly ComplianceWorkPeriodSource[];
	hypothetical: ComplianceShiftSource;
}): ComplianceFinding[] {
	const window: ScheduleComplianceWindow = {
		start: input.shiftDate,
		endExclusive: input.shiftDate.add({ days: JUDGED_DAYS }),
	};
	const evaluate = (shifts: readonly ComplianceShiftSource[]) =>
		evaluateScheduleCompliance({
			timezone: input.timezone,
			window,
			regulation: input.regulation,
			employees: [
				buildEmployeeComplianceInput({
					employeeId: input.employeeId,
					shifts,
					workPeriods: input.workPeriods,
					timezone: input.timezone,
				}),
			],
		}).findings;

	const existing = new Set(evaluate(input.shifts).map(findingKey));
	return evaluate([...input.shifts, input.hypothetical]).filter(
		(finding) => !existing.has(findingKey(finding)),
	);
}
