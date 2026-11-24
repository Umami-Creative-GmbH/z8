/**
 * JArbSchG breaches as statutory findings (#1993), pure. Shared by Scheduling, Staffing and the
 * clock-out check so all three agree on subjects and fingerprints.
 */
import {
	compareInstants,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { statutoryFindingId, type StatutoryFinding } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import { isMinorOn } from "./age";
import {
	evaluateJarbschg,
	type JarbschgBreach,
	type JarbschgEvaluationInput,
	type JarbschgLimits,
	type JarbschgRule,
	JARBSCHG_SECTOR_MAX_SHIFT_SPAN_MINUTES,
	jarbschgLegalReference,
	jarbschgMinimumRules,
	jarbschgSectorExceptionRules,
	type YouthWorkInterval,
} from "./jarbschg-rules";

/** The material step of flagged minutes a sector exception for work outside a shift is given in. */
const SECTOR_EXCEPTION_STEP_MINUTES = 15;

const toMaterialStep = (minutes: number) =>
	Math.ceil(minutes / SECTOR_EXCEPTION_STEP_MINUTES) * SECTOR_EXCEPTION_STEP_MINUTES;

/**
 * The input fingerprint of a sector-exception finding (night, Saturday, Sunday, holiday work): what
 * the exception decision depends on. For a planned shift that is the shift's exact times and how
 * much of the breach its work runs outside them, rounded up to a material step, so the
 * acknowledgement stays current while the shift is worked as planned (or is still being worked
 * within its bounds), and while an open clock-in overruns it within the acknowledged step; it goes
 * stale when the shift moves or its work overruns it further. Work without a planned shift is
 * acknowledged per work entry, by its start and the flagged minutes the exception covers, rounded up to a material step:
 * an acknowledgement given while the clock-in runs covers the work up to the end of that step, and
 * goes stale once the work runs on past it.
 */
export function sectorExceptionFingerprint(input: {
	readonly rule: JarbschgRule;
	readonly employeeId: string;
	readonly breach: Pick<JarbschgBreach, "outsidePlannedShift" | "coveredMinutes">;
	readonly interval: YouthWorkInterval;
}): string {
	const shift = input.interval.plannedShift;
	if (shift) {
		return statutoryInputFingerprint({
			rule: input.rule,
			employeeId: input.employeeId,
			subjectKey: shift.ref,
			start: shift.start,
			end: shift.end,
			outside: toMaterialStep(input.breach.outsidePlannedShift ?? 0),
		});
	}
	const planned = !input.interval.recorded && !input.interval.inProgress;
	if (planned) {
		// A shift not yet worked: the same fingerprint as its work within its bounds.
		return statutoryInputFingerprint({
			rule: input.rule,
			employeeId: input.employeeId,
			subjectKey: input.interval.ref,
			start: input.interval.start,
			end: input.interval.end,
			outside: 0,
		});
	}
	return statutoryInputFingerprint({
		rule: input.rule,
		employeeId: input.employeeId,
		subjectKey: input.interval.ref,
		start: input.interval.start,
		end: null,
		outside: 0,
		covered: toMaterialStep(input.breach.coveredMinutes ?? 0),
	});
}

/** A planned shift's bounds, as the day's shift span is judged against them. */
interface PlannedShiftBounds {
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
}

/**
 * The planned shifts behind a local day's work: the shifts its work belongs to and those still to
 * be worked, each once, in start order. The same before, while and after the day is worked.
 */
export function plannedShiftsOfDay(
	intervals: readonly YouthWorkInterval[],
	day: string,
	timezone: string,
): PlannedShiftBounds[] {
	const shifts = new Map<string, PlannedShiftBounds>();
	for (const interval of intervals) {
		if (plainDateAt(interval.start, timezone).toString() !== day) continue;
		const shift =
			interval.plannedShift ?? (!interval.recorded && !interval.inProgress ? interval : null);
		if (shift && !shifts.has(shift.ref)) {
			shifts.set(shift.ref, { ref: shift.ref, start: shift.start, end: shift.end });
		}
	}
	return [...shifts.values()].sort(
		(a, b) => compareInstants(a.start, b.start) || compareInstants(a.end, b.end),
	);
}

/**
 * The input fingerprint of a § 12 shift span acknowledged as a sector exception: the day, its
 * planned shifts' exact times and how far the span runs past the planned shifts' span, in whole
 * material steps (rounded down). Working the day roughly as planned (clocked in a few minutes
 * early, out a few minutes late or early) keeps the acknowledgement current; other shifts, or a
 * span 15 minutes or more past the planned one, make it stale. Work without planned shifts is
 * judged by its whole span, in the same steps. A span past 11 hours is never acknowledgeable.
 */
export function sectorShiftSpanFingerprint(input: {
	readonly employeeId: string;
	readonly subjectKey: string;
	readonly day: string;
	readonly spanMinutes: number;
	readonly plannedShifts: readonly PlannedShiftBounds[];
}): string {
	const first = input.plannedShifts[0];
	const plannedSpan = first
		? Math.round(
				first.start
					.until(
						input.plannedShifts.reduce(
							(latest, shift) => (compareInstants(shift.end, latest) > 0 ? shift.end : latest),
							first.end,
						),
					)
					.total({ unit: "minutes" }),
			)
		: 0;
	const overrun = Math.max(0, input.spanMinutes - plannedSpan);
	return statutoryInputFingerprint({
		rule: "jarbschg_shift_span",
		employeeId: input.employeeId,
		subjectKey: input.subjectKey,
		day: input.day,
		shifts: input.plannedShifts.map((shift) => [
			shift.ref,
			shift.start.toString(),
			shift.end.toString(),
		]),
		overrunSteps: Math.floor(overrun / SECTOR_EXCEPTION_STEP_MINUTES),
	});
}

export function jarbschgFindingOf(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly breach: JarbschgBreach;
	readonly interval: YouthWorkInterval;
	/** The planned shifts of the breach's day (`plannedShiftsOfDay`), for a § 12 shift span. */
	readonly dayPlannedShifts?: readonly PlannedShiftBounds[];
	readonly blockPublish: boolean;
}): StatutoryFinding<JarbschgRule> {
	const { breach, interval } = input;
	const sectorException = jarbschgSectorExceptionRules.has(breach.rule);
	// § 12: a span of up to 11 h is lawful in the sectors the law names; the admin acknowledges that
	// the sector applies, as for the other sector exceptions. Judged by the day's span alone.
	const sectorShiftSpan =
		breach.rule === "jarbschg_shift_span" &&
		breach.actual <= JARBSCHG_SECTOR_MAX_SHIFT_SPAN_MINUTES;
	// Work is covered by the sector exception acknowledged for its planned shift.
	const subjectKey =
		sectorException || sectorShiftSpan ? (interval.plannedShift?.ref ?? breach.ref) : breach.ref;
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
			...(jarbschgMinimumRules.has(breach.rule) ? { limitDirection: "floor" as const } : {}),
		},
		adminDetail: null,
		inputFingerprint: sectorException
			? sectorExceptionFingerprint({
					rule: breach.rule,
					employeeId: input.employeeId,
					breach,
					interval,
				})
			: sectorShiftSpan
				? sectorShiftSpanFingerprint({
						employeeId: input.employeeId,
						subjectKey,
						day: breach.day,
						spanMinutes: breach.actual,
						plannedShifts: input.dayPlannedShifts ?? [],
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
		acknowledgementKind: sectorException || sectorShiftSpan ? "jarbschg_sector_exception" : null,
		...(sectorException && breach.coveredMinutes !== undefined
			? { coveredMinutes: breach.coveredMinutes }
			: {}),
		// Recorded or running work cannot be unpublished; only planned shifts block publication.
		blocksPublication: input.blockPublish && !interval.recorded && !interval.inProgress,
	};
}

/**
 * Rules attributed by position rather than to the work they are about: the rest period to the
 * day's first piece of work, the daily and weekly maximum to the work past the running cap, the
 * sixth working day to that day's work. An edit that reorders the day moves such a breach to
 * another shift, so it is identified by what it judges: the day, or the compliance week.
 */
const positionalScope: Partial<Record<JarbschgRule, "day" | "week">> = {
	jarbschg_rest_period: "day",
	jarbschg_daily_max: "day",
	jarbschg_weekly_max: "week",
	jarbschg_days_per_week: "week",
	jarbschg_shift_span: "day",
};

/**
 * What a position-attributed youth breach is about: rule, employee and judged day or week (from
 * the finding's `periodStart`). Null for findings about their own work.
 */
export function youthBreachScopeOf(
	finding: Pick<StatutoryFinding, "kind" | "employeeId" | "periodStart">,
): string | null {
	const scope = positionalScope[finding.kind as JarbschgRule];
	if (!scope) return null;
	const day = parsePlainDate(finding.periodStart);
	const judged = scope === "day" ? day : day.subtract({ days: day.dayOfWeek - 1 });
	return JSON.stringify([finding.kind, finding.employeeId, scope, judged.toString()]);
}

/** Every local day: sector-exception totals cover all the work given, not only the judged days. */
const EVERY_DAY = { start: "0001-01-01", endExclusive: "9999-12-31" } as const;

/** One employee's JArbSchG findings on the judged days; one finding per rule and subject. */
export function youthFindingsOf(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly birthday: PlainDate | null;
	readonly timezone: string;
	readonly intervals: readonly YouthWorkInterval[];
	readonly judged: { readonly start: string; readonly endExclusive: string };
	readonly report?: JarbschgEvaluationInput["report"];
	readonly limitsOn: (day: PlainDate) => JarbschgLimits | null;
	readonly holidays: ReadonlySet<string>;
	/** Apprentice school and exam time credited as working time. */
	readonly credits?: JarbschgEvaluationInput["credits"];
	readonly blockPublish: boolean;
	/**
	 * The minutes a sector-exception finding reports as used. `whole_subject` (default): every
	 * piece of its shift's work, whichever day, as its fingerprint does. `judged_days`: only the
	 * pieces starting on a judged day, so the clock-out records each local day's own night once
	 * (the fingerprint, and so the acknowledgement state, still covers the whole shift).
	 */
	readonly sectorMinutes?: "whole_subject" | "judged_days";
	/** Local days spent as an External Contractor: no youth limit judges them (#1996). */
	readonly contractorDays?: ReadonlySet<string>;
}): StatutoryFinding<JarbschgRule>[] {
	const byRef = new Map(input.intervals.map((interval) => [interval.ref, interval]));
	const evaluate = (
		judged: JarbschgEvaluationInput["judged"],
		report: JarbschgEvaluationInput["report"],
	) =>
		evaluateJarbschg({
			timezone: input.timezone,
			intervals: input.intervals,
			judged,
			report,
			isMinorOn: (day) =>
				!input.contractorDays?.has(day.toString()) && isMinorOn(input.birthday, day),
			limitsOn: input.limitsOn,
			holidays: input.holidays,
			credits: input.credits,
		});
	const findingOf = (breach: JarbschgBreach) => {
		const interval = byRef.get(breach.ref);
		return interval
			? jarbschgFindingOf({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					breach,
					interval,
					...(breach.rule === "jarbschg_shift_span"
						? { dayPlannedShifts: plannedShiftsOfDay(input.intervals, breach.day, input.timezone) }
						: {}),
					blockPublish: input.blockPublish,
				})
			: null;
	};

	// A shift's work may lie in several pieces (a night shift clocked before and after midnight, a
	// shift clocked out of for lunch with the rest still planned): its sector-exception finding
	// totals every piece, whichever days are judged, so Scheduling, Staffing, clock-out and the
	// acknowledgement action agree on its fingerprint, and an edit that extends the shift deepens it.
	const sectorTotals = new Map<string, { night: number; outside: number; covered: number }>();
	for (const breach of evaluate(EVERY_DAY, "judged_days")) {
		if (!jarbschgSectorExceptionRules.has(breach.rule)) continue;
		const finding = findingOf(breach);
		if (!finding) continue;
		const total = sectorTotals.get(finding.id) ?? { night: 0, outside: 0, covered: 0 };
		if (breach.unit === "minutes") total.night += breach.actual;
		total.outside += breach.outsidePlannedShift ?? 0;
		total.covered += breach.coveredMinutes ?? 0;
		sectorTotals.set(finding.id, total);
	}

	const judgedBreaches = evaluate(input.judged, input.report);
	const sectorIdOf = (breach: JarbschgBreach) =>
		statutoryFindingId(breach.rule, input.employeeId, subjectKeyOf(breach));
	/**
	 * A sector finding's minutes in the judged breaches alone (`sectorMinutes: "judged_days"`): its
	 * night minutes, and the work it covers.
	 */
	const judgedTotals = new Map<string, { night: number; covered: number }>();
	if (input.sectorMinutes === "judged_days") {
		for (const breach of judgedBreaches) {
			if (!jarbschgSectorExceptionRules.has(breach.rule)) continue;
			const id = sectorIdOf(breach);
			const total = judgedTotals.get(id) ?? { night: 0, covered: 0 };
			if (breach.unit === "minutes") total.night += breach.actual;
			total.covered += breach.coveredMinutes ?? 0;
			judgedTotals.set(id, total);
		}
	}

	const findings = new Map<string, StatutoryFinding<JarbschgRule>>();
	for (const breach of judgedBreaches) {
		const id = sectorIdOf(breach);
		const total = sectorTotals.get(id);
		const judged = judgedTotals.get(id);
		const finding = findingOf(
			total
				? {
						...breach,
						actual: breach.unit === "minutes" ? (judged?.night ?? total.night) : breach.actual,
						outsidePlannedShift: total.outside,
						coveredMinutes: judged?.covered ?? total.covered,
					}
				: breach,
		);
		if (!finding) continue;
		const earlier = findings.get(finding.id);
		findings.set(
			finding.id,
			earlier
				? {
						...earlier,
						blocksPublication:
							(earlier.blocksPublication ?? false) || (finding.blocksPublication ?? false),
					}
				: finding,
		);
	}
	return [...findings.values()];

	function subjectKeyOf(breach: JarbschgBreach): string {
		const interval = byRef.get(breach.ref);
		return jarbschgSectorExceptionRules.has(breach.rule)
			? (interval?.plannedShift?.ref ?? breach.ref)
			: breach.ref;
	}
}
