import type { StatutoryScheduleContributor } from "../scheduling/contributor";
import { evaluateWorkingStudents } from "./monitor";

/**
 * #1991: working-student 20-hour lecture weeks and the rolling 26-week ceiling in Scheduling
 * (publish evaluation, compliance banner) and Staffing suggestions. Advisory only.
 */
export const workingStudentScheduleContributor: StatutoryScheduleContributor = {
	domain: "working_student",
	async evaluate(context) {
		const evaluations = await evaluateWorkingStudents(context.db, {
			organizationId: context.organizationId,
			timezone: context.timezone,
			window: context.window,
			employeeIds: context.employeeIds,
			now: context.now,
			proposedShifts: context.proposedShifts,
			replacesShiftId: context.replacesShiftId,
			preferences: context.preferences,
			judgeCeilingForward: true,
		});
		return evaluations.flatMap((evaluation) => evaluation.findings);
	},
};
