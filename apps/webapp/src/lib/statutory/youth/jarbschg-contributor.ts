/**
 * JArbSchG youth protection in Scheduling and Staffing (#1993). Every employee who is under 18 on
 * a judged day is held to the youth limits, whatever their employment profile, ArbZG scope or
 * work policy; from the 18th birthday on, adult rules apply alone. Time spent as an External
 * Contractor (#1996, #2010) is no employee's and is not judged: neither its days nor, on a
 * conversion day, its work and shifts before (or after) the conversion instant. Unless the
 * organization applies JArbSchG to minor contractors (#2022): then their contractor time is
 * judged like employee time.
 *
 * The work judged is recorded work, open clock-ins and the planned shifts (draft and published)
 * not yet worked, plus Staffing's proposal (`youthIntervalsOf`), with an apprentice's school and
 * exam time credited as working time (`school-credits.ts`). Each broken rule is its own
 * finding kind on the shift (or recorded work) it is attributed to; breaches on neighbouring days
 * that work on a judged day helps cause (rest before the next day, weekly totals later in the
 * week) are reported too, so a proposal sees everything it breaks. Night, Saturday, Sunday and
 * ordinary holiday findings can be acknowledged as a statutory sector exception; work on 24 and
 * 31 December after 14:00, 25 December, 1 January, Easter Sunday or 1 May never can. With the
 * organization's `blockJarbschgShiftPublish` on, every finding on a planned shift blocks
 * publication until it is resolved or, for those four, acknowledged.
 */
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import type { StatutoryFinding } from "../finding";
import type {
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "../scheduling/contributor";
import { isMinorOn } from "./age";
import type { YouthWorkInterval } from "./jarbschg-rules";
import {
	daysWithoutEmployeeTime,
	loadEmployeeBirthdays,
	loadJarbschgLimits,
	loadYouthJudgedTime,
	loadYouthShifts,
	loadYouthWork,
} from "./youth-facts";
import { employeeIntervalOf } from "../employee-time";
import { loadHolidayDateKeys } from "../holiday-days";
import { loadYouthSchoolCredits } from "./school-credits";
import { youthBreachScopeOf, youthFindingsOf } from "./youth-findings";
import { plannedYouthInterval, type YouthShiftRecord, youthIntervalsOf } from "./youth-intervals";

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 });

/** The subject of a proposed (not yet persisted) Staffing shift. */
export function proposedShiftSubjectKey(shift: {
	readonly date: string;
	readonly startTime: string;
	readonly endTime: string;
}): string {
	return `proposed:${shift.date}T${shift.startTime}-${shift.endTime}`;
}

function eachDay(from: PlainDate, until: PlainDate): PlainDate[] {
	const days: PlainDate[] = [];
	for (let day = from; day.until(until).sign > 0; day = day.add({ days: 1 })) days.push(day);
	return days;
}

async function evaluate(context: StatutoryScheduleContext): Promise<StatutoryFinding[]> {
	const windowStart = parsePlainDate(context.window.start);
	const windowEnd = parsePlainDate(context.window.endExclusive);
	const judgedDays = eachDay(windowStart, windowEnd);
	const birthdays = await loadEmployeeBirthdays(context.db, {
		organizationId: context.organizationId,
		employeeIds: context.employeeIds,
	});
	const underage = context.employeeIds.filter((employeeId) =>
		judgedDays.some((day) => isMinorOn(birthdays.get(employeeId) ?? null, day)),
	);
	if (underage.length === 0) return [];

	// Whole compliance weeks around the window, plus the day before and after for rest periods.
	const from = mondayOf(windowStart).subtract({ days: 1 });
	const until = mondayOf(windowEnd.subtract({ days: 1 })).add({ days: 8 });
	const range = { from: from.toString(), until: until.toString() };
	// External Contractor time is no employee's (#1996, #2010): youth limits judge none of it,
	// to the instant on a conversion day, unless the organization judges minor contractors under
	// JArbSchG (#2022).
	const employeeTime = await loadYouthJudgedTime(context.db, {
		organizationId: context.organizationId,
		employeeIds: underage,
		timezone: context.timezone,
		applyJarbschgToMinorContractors: context.preferences.applyJarbschgToMinorContractors,
	});
	const contractorDays = new Map(
		underage.map((employeeId) => [
			employeeId,
			daysWithoutEmployeeTime(employeeTime, employeeId, { timezone: context.timezone, ...range }),
		]),
	);
	const minors = underage.filter((employeeId) =>
		judgedDays.some(
			(day) =>
				!contractorDays.get(employeeId)?.has(day.toString()) &&
				isMinorOn(birthdays.get(employeeId) ?? null, day),
		),
	);
	if (minors.length === 0) return [];

	const limitsOn = await loadJarbschgLimits(context.db, range);
	const shifts = await loadYouthShifts(context.db, {
		organizationId: context.organizationId,
		organizationTimezone: context.timezone,
		employeeIds: minors,
		...range,
		excludeShiftId: context.replacesShiftId,
		excludeShiftIds: context.excludedShiftIds,
		employeeTime,
	});
	const work = await loadYouthWork(context.db, {
		organizationId: context.organizationId,
		employeeIds: minors,
		timezone: context.timezone,
		...range,
		employeeTime,
	});
	const holidays = await loadHolidayDateKeys(context.db, {
		organizationId: context.organizationId,
		employeeIds: minors,
		...range,
	});
	const credits = await loadYouthSchoolCredits(context.db, {
		organizationId: context.organizationId,
		employeeIds: minors,
		...range,
	});
	const shiftsOf = new Map<string, YouthShiftRecord[]>();
	for (const shift of shifts) {
		const own = shiftsOf.get(shift.employeeId);
		if (own) own.push(shift);
		else shiftsOf.set(shift.employeeId, [shift]);
	}

	const findings: StatutoryFinding[] = [];
	for (const employeeId of minors) {
		const proposals: YouthWorkInterval[] = context.proposedShifts
			.filter((proposal) => proposal.employeeId === employeeId)
			.flatMap((proposal) => {
				const date = parsePlainDate(proposal.date);
				const planned = shiftInterval(
					{ date, startTime: proposal.startTime, endTime: proposal.endTime },
					context.timezone,
				);
				// Only its employee time, as for persisted shifts; it keeps its subject.
				const interval = employeeIntervalOf(employeeTime, employeeId, planned);
				return interval
					? [plannedYouthInterval(proposedShiftSubjectKey(proposal), interval, limitsOn(date))]
					: [];
			});
		const findingsOf = (withoutRunningGrowth: boolean) =>
			youthFindingsOf({
				organizationId: context.organizationId,
				employeeId,
				birthday: birthdays.get(employeeId) ?? null,
				timezone: context.timezone,
				intervals: [
					...youthIntervalsOf({
						work: work.get(employeeId) ?? [],
						shifts: shiftsOf.get(employeeId) ?? [],
						now: context.now,
						timezone: context.timezone,
						limitsOn,
						withoutRunningGrowth,
					}),
					...proposals,
				],
				judged: context.window,
				report: "touching_judged_days",
				limitsOn,
				holidays: holidays.get(employeeId) ?? new Set(),
				credits: credits.get(employeeId),
				blockPublish: context.preferences.blockJarbschgShiftPublish,
				contractorDays: contractorDays.get(employeeId),
			});
		const judged = findingsOf(false);
		const running = (work.get(employeeId) ?? []).some((record) => record.end === null);
		findings.push(...(running ? withStableDepth(judged, findingsOf(true)) : judged));
	}
	return findings;
}

/** The deeper of two findings of one rule: further above a ceiling, or further below a floor. */
function deeper(left: StatutoryFinding, right: StatutoryFinding): StatutoryFinding {
	const l = left.summary.used?.value ?? Number.NEGATIVE_INFINITY;
	const r = right.summary.used?.value ?? Number.NEGATIVE_INFINITY;
	if (left.summary.limitDirection === "floor") return r < l ? right : left;
	return r > l ? right : left;
}

/**
 * Each finding with the depth it has without the growth of running clock-ins (`stableDepth`),
 * read from the same findings judged on that view: null where only the running work breaks it.
 * A breach the rules attribute by position (rest period, shift span, daily and weekly maximum, days
 * per week) moves to another subject when the running work is left out (from the clock-in to the
 * day's last shift), so it is matched by what it judges (`youthBreachScopeOf`); any other by id.
 */
function withStableDepth(
	findings: readonly StatutoryFinding[],
	withoutGrowth: readonly StatutoryFinding[],
): StatutoryFinding[] {
	const byId = new Map(withoutGrowth.map((finding) => [finding.id, finding]));
	const byScope = new Map<string, StatutoryFinding>();
	for (const finding of withoutGrowth) {
		const scope = youthBreachScopeOf(finding);
		if (!scope) continue;
		const known = byScope.get(scope);
		byScope.set(scope, known ? deeper(known, finding) : finding);
	}
	return findings.map((finding) => {
		const scope = youthBreachScopeOf(finding);
		const without = scope ? (byId.get(finding.id) ?? byScope.get(scope)) : byId.get(finding.id);
		return {
			...finding,
			stableDepth: {
				used: without?.summary.used?.value ?? null,
				coveredMinutes: without?.coveredMinutes ?? null,
			},
		};
	});
}

export const jarbschgScheduleContributor: StatutoryScheduleContributor = {
	domain: "youth_protection",
	evaluate,
};
