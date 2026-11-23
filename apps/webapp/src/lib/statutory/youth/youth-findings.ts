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

/**
 * The input fingerprint of a sector-exception finding (night, Saturday, Sunday, holiday work): what
 * the exception decision depends on. For a planned shift that is the shift's exact times and how
 * much of the breach its work runs outside them, so the acknowledgement stays current while the
 * shift is worked as planned (or is still being worked within its bounds) and goes stale when
 * the shift moves or its work overruns it. Work without a planned shift is acknowledged per work
 * entry, by its start.
 */
export function sectorExceptionFingerprint(input: {
	readonly rule: JarbschgRule;
	readonly employeeId: string;
	readonly breach: Pick<JarbschgBreach, "outsidePlannedShift">;
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
			outside: input.breach.outsidePlannedShift ?? 0,
		});
	}
	const planned = !input.interval.recorded && !input.interval.inProgress;
	return statutoryInputFingerprint({
		rule: input.rule,
		employeeId: input.employeeId,
		subjectKey: input.interval.ref,
		start: input.interval.start,
		end: planned ? input.interval.end : null,
		outside: 0,
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
	readonly blockPublish: boolean;
}): StatutoryFinding<JarbschgRule>[] {
	const byRef = new Map(input.intervals.map((interval) => [interval.ref, interval]));
	const findings = new Map<string, StatutoryFinding<JarbschgRule>>();
	for (const breach of evaluateJarbschg({
		timezone: input.timezone,
		intervals: input.intervals,
		judged: input.judged,
		report: input.report,
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
		const earlier = findings.get(finding.id);
		findings.set(finding.id, earlier ? mergeSameSubject(earlier, finding) : finding);
	}
	return [...findings.values()];
}

/**
 * Several pieces of work on one shift share a sector-exception subject: night minutes add up, and
 * the fingerprint covers every piece, so one overrunning piece makes the acknowledgement stale.
 * Other rules keep the first finding of a subject.
 */
function mergeSameSubject(
	earlier: StatutoryFinding<JarbschgRule>,
	later: StatutoryFinding<JarbschgRule>,
): StatutoryFinding<JarbschgRule> {
	if (!jarbschgSectorExceptionRules.has(earlier.kind)) return earlier;
	const used = earlier.summary.used;
	const fingerprints = [...new Set([earlier.inputFingerprint, later.inputFingerprint])].sort();
	return {
		...earlier,
		summary:
			used?.unit === "minutes"
				? {
						...earlier.summary,
						used: { ...used, value: used.value + (later.summary.used?.value ?? 0) },
					}
				: earlier.summary,
		inputFingerprint:
			fingerprints.length === 1 ? fingerprints[0] : statutoryInputFingerprint(fingerprints),
		blocksPublication: (earlier.blocksPublication ?? false) || (later.blocksPublication ?? false),
	};
}
