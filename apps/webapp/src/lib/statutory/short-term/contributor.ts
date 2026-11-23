import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { StatutoryScheduleContributor } from "../scheduling/contributor";
import { evaluateShortTermEmployment } from "./evaluate";

function windowDays(window: { start: string; endExclusive: string }): string[] {
	const days: string[] = [];
	const end = parsePlainDate(window.endExclusive);
	for (
		let day = parsePlainDate(window.start);
		day.until(end).days > 0;
		day = day.add({ days: 1 })
	) {
		days.push(day.toString());
	}
	return days;
}

/**
 * #1990: the short-term allowance (70 working days or 3 months per calendar year) of employees who
 * are short-term in the judged window. Planners see used, remaining and limit days or months. The
 * Berufsmäßigkeit prompt is left out: it is an org-admin review of earnings, not a scheduling limit.
 */
export const shortTermScheduleContributor: StatutoryScheduleContributor = {
	domain: "short_term",
	async evaluate(context) {
		const days = windowDays(context.window);
		if (days.length === 0) return [];
		const years = [...new Set(days.map((day) => Number(day.slice(0, 4))))];
		const evaluations = await evaluateShortTermEmployment(context.db, {
			organizationId: context.organizationId,
			timezone: context.timezone,
			employeeIds: context.employeeIds,
			years,
			now: context.now,
			scopeDates: days,
			proposedShifts: context.proposedShifts,
			replacesShiftId: context.replacesShiftId,
			preferences: context.preferences,
		});
		return evaluations.flatMap((evaluation) =>
			evaluation.findings.filter(
				(finding) => finding.kind !== "short_term_berufsmaessigkeit_check",
			),
		);
	},
};
