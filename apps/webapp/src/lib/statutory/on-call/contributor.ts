import type { StatutoryScheduleContributor } from "../scheduling/contributor";
import { evaluateOnCallFindings } from "./monitor";

/** § 12 TzBfG on-call findings for Scheduling and Staffing (#1992). */
export const onCallScheduleContributor: StatutoryScheduleContributor = {
	domain: "on_call",
	evaluate: (context) =>
		evaluateOnCallFindings(context.db, {
			organizationId: context.organizationId,
			timezone: context.timezone,
			window: context.window,
			employeeIds: context.employeeIds,
			proposedShifts: context.proposedShifts,
			replacesShiftId: context.replacesShiftId,
			preferences: context.preferences,
			now: context.now,
		}),
};
