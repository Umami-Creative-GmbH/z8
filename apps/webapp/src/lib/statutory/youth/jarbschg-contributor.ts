/**
 * JArbSchG youth protection in Scheduling and Staffing (#1993). Every employee who is under 18 on
 * a judged day is held to the youth limits, whatever their employment profile, ArbZG scope or
 * work policy; from the 18th birthday on, adult rules apply alone.
 *
 * Days before today are judged by recorded work, today and later by planned shifts (draft and
 * published) plus Staffing's proposal. Each broken rule is its own finding kind on the shift (or
 * recorded work) it is attributed to. Night, Saturday, Sunday and holiday findings can be
 * acknowledged as a statutory sector exception; with the organization's
 * `blockJarbschgShiftPublish` on, every finding on a planned shift blocks publication until it is
 * resolved or, for those four, acknowledged.
 */
import { plainDateAt, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { statutoryFindingId, type StatutoryFinding } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type { StatutoryScheduleContext, StatutoryScheduleContributor } from "../scheduling/contributor";
import { isMinorOn } from "./age";
import {
	evaluateJarbschg,
	type JarbschgBreach,
	type JarbschgLimits,
	type JarbschgRule,
	jarbschgLegalReference,
	jarbschgSectorExceptionRules,
	type YouthWorkInterval,
} from "./jarbschg-rules";
import {
	loadEmployeeBirthdays,
	loadHolidayDateKeys,
	loadJarbschgLimits,
	loadYouthShifts,
	loadYouthWork,
	plannedYouthInterval,
	sectorExceptionFingerprint,
	withPlannedShifts,
} from "./youth-facts";

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

export function jarbschgFindingOf(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly breach: JarbschgBreach;
	readonly interval: YouthWorkInterval;
	readonly blockPublish: boolean;
}): StatutoryFinding<JarbschgRule> {
	const { breach, interval } = input;
	const sectorException = jarbschgSectorExceptionRules.has(breach.rule);
	// Recorded work is covered by the sector exception acknowledged for its planned shift.
	const exceptionSubject = sectorException ? (interval.plannedShift ?? null) : null;
	const subjectKey = exceptionSubject?.ref ?? breach.ref;
	const unit = breach.unit;
	return {
		id: statutoryFindingId(breach.rule, input.employeeId, subjectKey),
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		domain: "youth_protection",
		kind: breach.rule,
		severity: "critical",
		subjectKey,
		periodStart: breach.day,
		periodEnd: parsePlainDate(breach.day).add({ days: 1 }).toString(),
		legalReference: jarbschgLegalReference[breach.rule],
		summary: {
			tier: "exceeded",
			used: { unit, value: breach.actual },
			limit: { unit, value: breach.limit },
		},
		adminDetail: null,
		inputFingerprint: sectorException
			? sectorExceptionFingerprint({
					rule: breach.rule,
					employeeId: input.employeeId,
					subjectKey,
					interval: exceptionSubject ?? interval,
				})
			: statutoryInputFingerprint({
					rule: breach.rule,
					employeeId: input.employeeId,
					subjectKey: breach.ref,
					start: interval.start,
					end: interval.end,
					actual: breach.actual,
					limit: breach.limit,
				}),
		acknowledgementKind: sectorException ? "jarbschg_sector_exception" : null,
		// Recorded work cannot be unpublished; only planned shifts block publication.
		blocksPublication: input.blockPublish && !interval.recorded,
	};
}

async function evaluate(context: StatutoryScheduleContext): Promise<StatutoryFinding[]> {
	const windowStart = parsePlainDate(context.window.start);
	const windowEnd = parsePlainDate(context.window.endExclusive);
	const judgedDays = eachDay(windowStart, windowEnd);
	const birthdays = await loadEmployeeBirthdays(context.db, {
		organizationId: context.organizationId,
		employeeIds: context.employeeIds,
	});
	const minors = context.employeeIds.filter((employeeId) =>
		judgedDays.some((day) => isMinorOn(birthdays.get(employeeId) ?? null, day)),
	);
	if (minors.length === 0) return [];

	// Whole compliance weeks around the window, plus the day before for the first rest period.
	const from = mondayOf(windowStart).subtract({ days: 1 });
	const until = mondayOf(windowEnd.subtract({ days: 1 })).add({ days: 7 });
	const today = plainDateAt(context.now, context.timezone);
	const range = { from: from.toString(), until: until.toString() };

	const shifts = await loadYouthShifts(context.db, {
		organizationId: context.organizationId,
		organizationTimezone: context.timezone,
		employeeIds: minors,
		...range,
		excludeShiftId: context.replacesShiftId,
	});
	const work = await loadYouthWork(context.db, {
		organizationId: context.organizationId,
		employeeIds: minors,
		timezone: context.timezone,
		...range,
	});
	const holidays = await loadHolidayDateKeys(context.db, {
		organizationId: context.organizationId,
		employeeIds: minors,
		...range,
	});
	const limitsOn = await loadJarbschgLimits(context.db, range);

	const findings: StatutoryFinding[] = [];
	for (const employeeId of minors) {
		const isPast = (interval: YouthWorkInterval) =>
			plainDateAt(interval.start, context.timezone).until(today).sign > 0;
		const employeeShifts = shifts.filter((shift) => shift.employeeId === employeeId);
		const intervals: YouthWorkInterval[] = [
			...withPlannedShifts((work.get(employeeId) ?? []).filter(isPast), employeeShifts),
			...employeeShifts.map((shift) => shift.interval).filter((interval) => !isPast(interval)),
			...context.proposedShifts
				.filter((proposal) => proposal.employeeId === employeeId)
				.map((proposal) =>
					plannedYouthInterval(
						proposedShiftSubjectKey(proposal),
						{
							date: parsePlainDate(proposal.date),
							startTime: proposal.startTime,
							endTime: proposal.endTime,
						},
						context.timezone,
					),
				),
		];
		findings.push(
			...youthFindingsOf({
				organizationId: context.organizationId,
				employeeId,
				birthday: birthdays.get(employeeId) ?? null,
				timezone: context.timezone,
				intervals,
				judged: context.window,
				limitsOn,
				holidays: holidays.get(employeeId) ?? new Set(),
				blockPublish: context.preferences.blockJarbschgShiftPublish,
			}),
		);
	}
	return findings;
}

/** One employee's JArbSchG findings on the judged days; one finding per rule and subject. */
export function youthFindingsOf(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly birthday: PlainDate | null;
	readonly timezone: string;
	readonly intervals: readonly YouthWorkInterval[];
	readonly judged: { readonly start: string; readonly endExclusive: string };
	readonly limitsOn: (day: PlainDate) => JarbschgLimits | null;
	readonly holidays: ReadonlySet<string>;
	readonly blockPublish: boolean;
}): StatutoryFinding<JarbschgRule>[] {
	const byRef = new Map(input.intervals.map((interval) => [interval.ref, interval]));
	const findings = new Map<string, StatutoryFinding<JarbschgRule>>();
	for (const breach of evaluateJarbschg({
		timezone: input.timezone,
		intervals: input.intervals,
		judged: input.judged,
		isMinorOn: (day) => isMinorOn(input.birthday, day),
		limitsOn: input.limitsOn,
		holidays: input.holidays,
	})) {
		const interval = byRef.get(breach.ref);
		if (!interval) continue;
		const finding = jarbschgFindingOf({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			breach,
			interval,
			blockPublish: input.blockPublish,
		});
		if (!findings.has(finding.id)) findings.set(finding.id, finding);
	}
	return [...findings.values()];
}

export const jarbschgScheduleContributor: StatutoryScheduleContributor = {
	domain: "youth_protection",
	evaluate,
};
