/**
 * Evidence-only historical gap repair plans (#260 §1-§3, #256 §6, #320).
 *
 * The planner reads the same evidence and diagnostics as `assessHistoricalWork` and
 * decides, for each pre-adoption missing value (`historical_gap`), whether other
 * evidence establishes it uniquely. It never writes. The executor applies a plan
 * under shared writer coordination after re-planning from a fresh read.
 *
 * - Only `historical_gap` findings are candidates. Fresh post-adoption or backdated
 *   gaps are integrity incidents, and ambiguous provenance needs investigation.
 * - Work touched by any conflicting, suspected or non-historical finding is held
 *   whole: contradictory evidence is a review case even when one side looks right.
 * - A value is filled only from an agreeing representation of the same work:
 *   established canonical IDs and links are kept, durations are copied and never
 *   derived (the original rounding rule is unknown), offsets and entries are never
 *   invented, and approval history is never reconstructed from current status.
 * - A created canonical record takes its creator from the clock-out entry that
 *   completed the work. Without that evidence the original actor is unknown, which
 *   `time_record.created_by` cannot express, so creation is held (#260 §3). Every
 *   other fill records its original actor as `unknown_historical`; the executor
 *   records itself separately.
 */
import { createHash } from "node:crypto";
import { compareInstants, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { canonicalJson } from "./canonical-json";
import type {
	HistoricalEntryEvidence,
	HistoricalPeriodEvidence,
	HistoricalRecordEvidence,
	HistoricalWorkDiagnostics,
	HistoricalWorkEvidence,
	WorkFinding,
	WorkFindingKind,
} from "./historical-work-diagnostics";

export const HISTORICAL_GAP_REPAIR_PLAN_VERSION = 1;

/** Metadata a canonical work detail and its project allocation carry. */
export interface RepairedWorkDetail {
	workCategoryId: string | null;
	workLocationType: string | null;
}

export type GapRepairFill =
	| {
			kind: "canonical_record";
			findingId: string;
			recordId: string;
			record: {
				startAt: string;
				endAt: string;
				durationMinutes: number;
				approvalState: HistoricalPeriodEvidence["approvalStatus"];
			};
			detail: RepairedWorkDetail;
			projectId: string | null;
	  }
	| { kind: "canonical_link"; findingId: string; recordId: string }
	| {
			kind: "canonical_detail";
			findingId: string;
			recordId: string;
			detail: RepairedWorkDetail;
			projectId: string | null;
	  }
	| {
			kind: "canonical_completion";
			findingId: string;
			recordId: string;
			endAt: string;
			/** Null when the record already holds the same established minutes. */
			durationMinutes: number | null;
	  }
	| { kind: "canonical_duration"; findingId: string; recordId: string; durationMinutes: number }
	| {
			kind: "period_completion";
			findingId: string;
			endTime: string;
			/** Null when the period already holds the same established minutes. */
			durationMinutes: number | null;
	  }
	| { kind: "period_duration"; findingId: string; durationMinutes: number }
	| {
			kind: "canonical_metadata";
			findingId: string;
			recordId: string;
			field: "project" | "work_category" | "work_location_type";
			value: string;
	  };

/** Who performed the original action whose fact is being filled. */
export type RepairOriginalActor =
	| { kind: "human"; userId: string; evidence: { entryId: string; side: "end" } }
	| { kind: "unknown_historical" };

/** The field state the plan was made against; re-read under coordination before use. */
export interface GapRepairExpectedState {
	period: {
		graphRevision: number;
		canonicalRecordId: string | null;
		endTime: string | null;
		durationMinutes: number | null;
		approvalStatus: HistoricalPeriodEvidence["approvalStatus"];
	};
	record: {
		id: string;
		startAt: string;
		endAt: string | null;
		durationMinutes: number | null;
		approvalState: HistoricalRecordEvidence["approvalState"];
		detail: RepairedWorkDetail | null;
		projectIds: string[];
	} | null;
}

export interface GapRepairUnit {
	employeeId: string;
	workPeriodId: string;
	/** Existing canonical ID, or the period ID for a created record. */
	canonicalRecordId: string;
	expected: GapRepairExpectedState;
	fills: GapRepairFill[];
	originalActor: RepairOriginalActor;
	/** Stable identity of this unit's exact plan. */
	fingerprint: string;
}

export type GapHoldReason =
	/** Other findings on the same work conflict, are suspected or are not historical. */
	| "conflicting_evidence"
	/** No agreeing representation establishes the value. */
	| "no_restorable_evidence"
	/** A duration exists nowhere; the original calculation rule is not demonstrable. */
	| "original_rule_unknown"
	/** The original actor is unknown and the target field requires a human. */
	| "original_actor_unrepresentable"
	/** Active work is completed by its own writers, not by repair. */
	| "active_work"
	/** A referenced project or category is not the organization's. */
	| "reference_outside_organization";

export interface HeldGap {
	findingId: string;
	kind: WorkFindingKind;
	employeeIds: string[];
	workPeriodIds: string[];
	timeRecordIds: string[];
	reason: GapHoldReason;
	/** Findings that hold the work, for `conflicting_evidence`. */
	heldBy: string[];
}

export interface EmployeeGapRepairPlan {
	employeeId: string;
	/** Identity of every unit planned for the employee; the executor expects it unchanged. */
	fingerprint: string;
	units: GapRepairUnit[];
}

export interface HistoricalGapRepairPlan {
	version: typeof HISTORICAL_GAP_REPAIR_PLAN_VERSION;
	employees: EmployeeGapRepairPlan[];
	held: HeldGap[];
}

export interface HistoricalGapRepairInput {
	evidence: HistoricalWorkEvidence;
	/** Diagnostics assessed from `evidence` for the requested scope. */
	report: HistoricalWorkDiagnostics;
	/** Organization-owned references, read with an organization predicate. */
	references: { projectIds: ReadonlySet<string>; workCategoryIds: ReadonlySet<string> };
}

type Outcome = { fill: GapRepairFill; actor?: RepairOriginalActor } | { hold: GapHoldReason };

export function planHistoricalGapRepair(input: HistoricalGapRepairInput): HistoricalGapRepairPlan {
	const { evidence, report, references } = input;
	const periodsById = new Map(evidence.periods.map((period) => [period.id, period]));
	const recordsById = new Map(evidence.records.map((record) => [record.id, record]));
	const entriesById = new Map(evidence.entries.map((entry) => [entry.id, entry]));

	const held: HeldGap[] = [];
	const hold = (finding: WorkFinding, reason: GapHoldReason, heldBy: string[] = []) =>
		held.push({
			findingId: finding.id,
			kind: finding.kind,
			employeeIds: finding.employeeIds,
			workPeriodIds: finding.workPeriodIds,
			timeRecordIds: finding.timeRecordIds,
			reason,
			heldBy,
		});

	const gaps = report.findings.filter((finding) => finding.treatment === "historical_gap");
	const blockers = report.findings.filter(
		(finding) => finding.treatment !== "historical_gap" && finding.treatment !== "disclosed",
	);

	// A gap belongs to the one period it names; native-record gaps have no evidence.
	const gapsByPeriod = new Map<string, WorkFinding[]>();
	for (const gap of gaps) {
		const period = gap.workPeriodIds.length === 1 ? periodsById.get(gap.workPeriodIds[0]) : undefined;
		if (!period) {
			hold(gap, "no_restorable_evidence");
			continue;
		}
		gapsByPeriod.set(period.id, [...(gapsByPeriod.get(period.id) ?? []), gap]);
	}

	const units: GapRepairUnit[] = [];
	for (const [periodId, periodGaps] of gapsByPeriod) {
		const period = periodsById.get(periodId) as HistoricalPeriodEvidence;
		const record = representationOf(period, recordsById);
		const subjects = new Set([period.id, ...(record ? [record.id] : [])]);
		const touching = blockers.filter((finding) =>
			[...finding.workPeriodIds, ...finding.timeRecordIds].some((id) => subjects.has(id)),
		);
		if (touching.length > 0) {
			const heldBy = touching.map((finding) => finding.id);
			for (const gap of periodGaps) hold(gap, "conflicting_evidence", heldBy);
			continue;
		}

		const fills: GapRepairFill[] = [];
		let originalActor: RepairOriginalActor = { kind: "unknown_historical" };
		for (const gap of periodGaps.toSorted((left, right) => compareStrings(left.id, right.id))) {
			const outcome = fillFor(gap, period, record, entriesById, references);
			if ("hold" in outcome) {
				hold(gap, outcome.hold);
				continue;
			}
			fills.push(outcome.fill);
			if (outcome.actor) originalActor = outcome.actor;
		}
		if (fills.length === 0) continue;

		const expected = expectedStateOf(period, record);
		const unit = {
			employeeId: period.employeeId,
			workPeriodId: period.id,
			canonicalRecordId: record?.id ?? period.id,
			expected,
			fills,
			originalActor,
		};
		units.push({ ...unit, fingerprint: digest(canonicalJson(unit)) });
	}

	const byEmployee = new Map<string, GapRepairUnit[]>();
	for (const unit of units.toSorted((left, right) =>
		compareStrings(left.workPeriodId, right.workPeriodId),
	)) {
		byEmployee.set(unit.employeeId, [...(byEmployee.get(unit.employeeId) ?? []), unit]);
	}
	return {
		version: HISTORICAL_GAP_REPAIR_PLAN_VERSION,
		employees: [...byEmployee]
			.toSorted(([left], [right]) => compareStrings(left, right))
			.map(([employeeId, employeeUnits]) => ({
				employeeId,
				fingerprint: employeePlanFingerprint(employeeUnits),
				units: employeeUnits,
			})),
		held: held.toSorted((left, right) => compareStrings(left.findingId, right.findingId)),
	};
}

/** Identity of an employee's whole plan, compared by the executor after re-planning. */
export function employeePlanFingerprint(units: readonly GapRepairUnit[]): string {
	return digest(
		canonicalJson({
			version: HISTORICAL_GAP_REPAIR_PLAN_VERSION,
			units: units.map((unit) => unit.fingerprint).toSorted(),
		}),
	);
}

function fillFor(
	gap: WorkFinding,
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
	entriesById: ReadonlyMap<string, HistoricalEntryEvidence>,
	references: HistoricalGapRepairInput["references"],
): Outcome {
	const findingId = gap.id;
	switch (gap.kind) {
		case "canonical_link_missing": {
			if (!record || record.id !== period.id) return { hold: "no_restorable_evidence" };
			return { fill: { kind: "canonical_link", findingId, recordId: record.id } };
		}
		case "canonical_missing": {
			if (period.isActive || period.endTime === null) return { hold: "active_work" };
			if (period.durationMinutes === null) return { hold: "original_rule_unknown" };
			const completion = completingEntry(period, period.endTime, entriesById);
			if (!completion) return { hold: "original_actor_unrepresentable" };
			if (!referencesOwned(period, references)) return { hold: "reference_outside_organization" };
			return {
				fill: {
					kind: "canonical_record",
					findingId,
					recordId: period.id,
					record: {
						startAt: instantToCanonicalString(period.startTime),
						endAt: instantToCanonicalString(period.endTime),
						durationMinutes: period.durationMinutes,
						approvalState: period.approvalStatus,
					},
					detail: detailOf(period),
					projectId: period.projectId,
				},
				actor: {
					kind: "human",
					userId: completion.createdBy,
					evidence: { entryId: completion.id, side: "end" },
				},
			};
		}
		case "canonical_detail_missing": {
			if (!record || record.detail !== null) return { hold: "no_restorable_evidence" };
			if (
				period.projectId !== null &&
				record.projectIds.length > 0 &&
				!record.projectIds.includes(period.projectId)
			) {
				return { hold: "no_restorable_evidence" };
			}
			if (!referencesOwned(period, references)) return { hold: "reference_outside_organization" };
			return {
				fill: {
					kind: "canonical_detail",
					findingId,
					recordId: record.id,
					detail: detailOf(period),
					projectId: record.projectIds.length === 0 ? period.projectId : null,
				},
			};
		}
		case "endpoint_missing": {
			if (gap.details.side === "canonical_end") {
				// Linked closed work and its completing entry establish the completion.
				if (!record || record.endAt !== null || period.endTime === null) {
					return { hold: "no_restorable_evidence" };
				}
				if (!completingEntry(period, period.endTime, entriesById)) {
					return { hold: "no_restorable_evidence" };
				}
				if (period.durationMinutes === null) return { hold: "original_rule_unknown" };
				if (record.durationMinutes !== null && record.durationMinutes !== period.durationMinutes) {
					return { hold: "no_restorable_evidence" };
				}
				return {
					fill: {
						kind: "canonical_completion",
						findingId,
						recordId: record.id,
						endAt: instantToCanonicalString(period.endTime),
						durationMinutes: record.durationMinutes === null ? period.durationMinutes : null,
					},
				};
			}
			if (gap.details.side === "period_end") {
				// The canonical completion and the period's own clock-out entry must agree.
				if (!record || record.endAt === null || record.durationMinutes === null) {
					return { hold: "no_restorable_evidence" };
				}
				if (!completingEntry(period, record.endAt, entriesById)) {
					return { hold: "no_restorable_evidence" };
				}
				if (
					compareInstants(record.startAt, period.startTime) !== 0 ||
					compareInstants(record.endAt, period.startTime) <= 0
				) {
					return { hold: "no_restorable_evidence" };
				}
				if (period.durationMinutes !== null && period.durationMinutes !== record.durationMinutes) {
					return { hold: "no_restorable_evidence" };
				}
				return {
					fill: {
						kind: "period_completion",
						findingId,
						endTime: instantToCanonicalString(record.endAt),
						durationMinutes: period.durationMinutes === null ? record.durationMinutes : null,
					},
				};
			}
			return { hold: "no_restorable_evidence" };
		}
		case "duration_missing": {
			// Copied from an agreeing representation of the same interval; never derived.
			if (!record || !sameInterval(period, record)) return { hold: "original_rule_unknown" };
			if (gap.details.source === "canonical") {
				if (record.durationMinutes !== null || period.durationMinutes === null) {
					return { hold: "original_rule_unknown" };
				}
				return {
					fill: {
						kind: "canonical_duration",
						findingId,
						recordId: record.id,
						durationMinutes: period.durationMinutes,
					},
				};
			}
			if (gap.details.source === "period") {
				if (period.durationMinutes !== null || record.durationMinutes === null) {
					return { hold: "original_rule_unknown" };
				}
				return {
					fill: { kind: "period_duration", findingId, durationMinutes: record.durationMinutes },
				};
			}
			return { hold: "original_rule_unknown" };
		}
		case "metadata_missing": {
			const field = gap.details.field;
			const value = gap.details.periodValue;
			if (!record?.detail || typeof value !== "string") return { hold: "no_restorable_evidence" };
			if (field === "project") {
				if (record.projectIds.length > 0) return { hold: "no_restorable_evidence" };
				if (!references.projectIds.has(value)) return { hold: "reference_outside_organization" };
				return { fill: { kind: "canonical_metadata", findingId, recordId: record.id, field, value } };
			}
			if (field === "work_category") {
				if (record.detail.workCategoryId !== null) return { hold: "no_restorable_evidence" };
				if (!references.workCategoryIds.has(value)) {
					return { hold: "reference_outside_organization" };
				}
				return { fill: { kind: "canonical_metadata", findingId, recordId: record.id, field, value } };
			}
			if (field === "work_location_type") {
				if (record.detail.workLocationType !== null) return { hold: "no_restorable_evidence" };
				return { fill: { kind: "canonical_metadata", findingId, recordId: record.id, field, value } };
			}
			return { hold: "no_restorable_evidence" };
		}
		default:
			// Missing approval relationships and endpoint entries have no restorable
			// evidence: repair never starts a workflow or writes an append-chain entry.
			return { hold: "no_restorable_evidence" };
	}
}

/** The period's canonical representation, following the diagnostics' identity rules. */
function representationOf(
	period: HistoricalPeriodEvidence,
	recordsById: ReadonlyMap<string, HistoricalRecordEvidence>,
): HistoricalRecordEvidence | null {
	if (period.canonicalRecordId !== null) return recordsById.get(period.canonicalRecordId) ?? null;
	return recordsById.get(period.id) ?? null;
}

/** The period's own current clock-out entry at `endAt`: evidence of the completing action. */
function completingEntry(
	period: HistoricalPeriodEvidence,
	endAt: HistoricalPeriodEvidence["startTime"],
	entriesById: ReadonlyMap<string, HistoricalEntryEvidence>,
): HistoricalEntryEvidence | null {
	if (period.clockOutId === null) return null;
	const entry = entriesById.get(period.clockOutId);
	if (
		!entry ||
		entry.type !== "clock_out" ||
		entry.isSuperseded ||
		entry.employeeId !== period.employeeId ||
		compareInstants(entry.timestamp, endAt) !== 0
	) {
		return null;
	}
	return entry;
}

function sameInterval(period: HistoricalPeriodEvidence, record: HistoricalRecordEvidence) {
	return (
		period.endTime !== null &&
		record.endAt !== null &&
		compareInstants(period.startTime, record.startAt) === 0 &&
		compareInstants(period.endTime, record.endAt) === 0 &&
		compareInstants(period.endTime, period.startTime) > 0
	);
}

function referencesOwned(
	period: HistoricalPeriodEvidence,
	references: HistoricalGapRepairInput["references"],
) {
	return (
		(period.projectId === null || references.projectIds.has(period.projectId)) &&
		(period.workCategoryId === null || references.workCategoryIds.has(period.workCategoryId))
	);
}

function detailOf(period: HistoricalPeriodEvidence): RepairedWorkDetail {
	return { workCategoryId: period.workCategoryId, workLocationType: period.workLocationType };
}

function expectedStateOf(
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
): GapRepairExpectedState {
	return {
		period: {
			graphRevision: period.graphRevision,
			canonicalRecordId: period.canonicalRecordId,
			endTime: period.endTime ? instantToCanonicalString(period.endTime) : null,
			durationMinutes: period.durationMinutes,
			approvalStatus: period.approvalStatus,
		},
		record: record
			? {
					id: record.id,
					startAt: instantToCanonicalString(record.startAt),
					endAt: record.endAt ? instantToCanonicalString(record.endAt) : null,
					durationMinutes: record.durationMinutes,
					approvalState: record.approvalState,
					detail: record.detail
						? {
								workCategoryId: record.detail.workCategoryId,
								workLocationType: record.detail.workLocationType,
							}
						: null,
					projectIds: [...record.projectIds].toSorted(),
				}
			: null,
	};
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
