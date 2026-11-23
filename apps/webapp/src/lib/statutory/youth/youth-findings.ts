/**
 * JArbSchG breaches as statutory findings (#1993), pure. Shared by Scheduling, Staffing and the
 * clock-out check so all three agree on subjects and fingerprints.
 */
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { statutoryFindingId, type StatutoryFinding } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import { isMinorOn } from "./age";
import {
	evaluateJarbschg,
	type JarbschgBreach,
	type JarbschgEvaluationInput,
	type JarbschgLimits,
	type JarbschgRule,
	jarbschgLegalReference,
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

export function jarbschgFindingOf(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly breach: JarbschgBreach;
	readonly interval: YouthWorkInterval;
	readonly blockPublish: boolean;
}): StatutoryFinding<JarbschgRule> {
	const { breach, interval } = input;
	const sectorException = jarbschgSectorExceptionRules.has(breach.rule);
	// Work is covered by the sector exception acknowledged for its planned shift.
	const subjectKey = sectorException ? (interval.plannedShift?.ref ?? breach.ref) : breach.ref;
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
					breach,
					interval,
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
		// Recorded or running work cannot be unpublished; only planned shifts block publication.
		blocksPublication: input.blockPublish && !interval.recorded && !interval.inProgress,
	};
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
			isMinorOn: (day) => isMinorOn(input.birthday, day),
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
					blockPublish: input.blockPublish,
				})
			: null;
	};

	// A shift's work may lie on several days (a night shift clocked before and after midnight):
	// its sector-exception finding totals every piece, whichever days are judged, so Scheduling,
	// Staffing, clock-out and the acknowledgement action agree on its fingerprint.
	const sectorTotals = new Map<string, { night: number; outside: number }>();
	for (const breach of evaluate(EVERY_DAY, "judged_days")) {
		if (!jarbschgSectorExceptionRules.has(breach.rule)) continue;
		const finding = findingOf(breach);
		if (!finding) continue;
		const total = sectorTotals.get(finding.id) ?? { night: 0, outside: 0 };
		if (breach.unit === "minutes") total.night += breach.actual;
		total.outside += breach.outsidePlannedShift ?? 0;
		sectorTotals.set(finding.id, total);
	}

	const findings = new Map<string, StatutoryFinding<JarbschgRule>>();
	for (const breach of evaluate(input.judged, input.report)) {
		const total = sectorTotals.get(
			statutoryFindingId(breach.rule, input.employeeId, subjectKeyOf(breach)),
		);
		const finding = findingOf(
			total
				? {
						...breach,
						actual: breach.unit === "minutes" ? total.night : breach.actual,
						outsidePlannedShift: total.outside,
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
