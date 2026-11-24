/**
 * #1989 Minijob monitor in Scheduling and Staffing: findings for every calendar month the judged
 * window touches. The seam projects them wage-free (tier only: Minijob findings are earnings-derived).
 */
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { StatutoryScheduleContributor } from "../scheduling/contributor";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { addMonths } from "./minijob-months";

export const minijobScheduleContributor: StatutoryScheduleContributor = {
	domain: "minijob",
	async evaluate(context) {
		const lastDay = parsePlainDate(context.window.endExclusive).subtract({ days: 1 });
		const from = context.window.start.slice(0, 7);
		const until = addMonths(lastDay.toString().slice(0, 7), 1);
		const { findings } = await evaluateMinijobEarnings(context.db, {
			organizationId: context.organizationId,
			timezone: context.timezone,
			employeeIds: context.employeeIds,
			months: { from, until },
			preferences: context.preferences,
			now: context.now,
			proposedShifts: context.proposedShifts,
			replacesShiftId: context.replacesShiftId,
		});
		return findings;
	},
};
