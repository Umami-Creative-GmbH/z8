/**
 * The record agreement refusals every plan step shares (ADR 0010): the locked
 * pair must be completed work with its canonical work record, its minutes and
 * record agreement (apart from drift a change tolerates), and every planned pair
 * must agree. One copy, so no plan step checks less than another. Pure, no I/O,
 * no server-only imports.
 */
import type { ToleratedDrift } from "./amend-change";
import type { WorkRecordRefusal } from "./change";
import {
	type AgreementCanonicalRecord,
	type AgreementWorkPeriod,
	recordAgreement,
} from "./record-agreement";

type Pair = { period: AgreementWorkPeriod; canonical: AgreementCanonicalRecord | null };

/** A locked pair a change may plan from: completed, with its record and minutes, agreeing. */
export type AgreeingPair = {
	period: AgreementWorkPeriod & { endTime: Date; durationMinutes: number };
	canonical: AgreementCanonicalRecord;
};

/**
 * The locked pair, or why a change may not plan from it: running work, a
 * missing canonical work record, completed work without minutes, or a pair
 * that disagrees beyond the drift the change tolerates (which it rewrites
 * from the work period).
 */
export function agreeingPair(
	pair: Pair,
	toleratedDrift: readonly ToleratedDrift[] = [],
): AgreeingPair | WorkRecordRefusal {
	const { period, canonical } = pair;
	if (period.endTime === null) return { kind: "work_running" };
	if (!canonical) return { kind: "canonical_record_missing" };
	// Completed work without minutes on either side is not a pair a change can plan from.
	if (period.durationMinutes === null) {
		return { kind: "canonical_divergence", found: "locked_pair", disagreements: ["duration"] };
	}
	const disagreements = recordAgreement(period, canonical).disagreements.filter(
		(facet) => !(toleratedDrift as readonly string[]).includes(facet),
	);
	if (disagreements.length > 0) {
		return { kind: "canonical_divergence", found: "locked_pair", disagreements };
	}
	return {
		period: { ...period, endTime: period.endTime, durationMinutes: period.durationMinutes },
		canonical,
	};
}

/** The first planned pair that would disagree, as a refusal, or null when all agree. */
export function plannedPairsRefusal(
	planned: readonly { period: AgreementWorkPeriod; canonical: AgreementCanonicalRecord }[],
	found: "planned_half" | "planned_amendment" | "planned_repair",
): WorkRecordRefusal | null {
	for (const pair of planned) {
		const { agrees, disagreements } = recordAgreement(pair.period, pair.canonical);
		if (!agrees) return { kind: "canonical_divergence", found, disagreements };
	}
	return null;
}
