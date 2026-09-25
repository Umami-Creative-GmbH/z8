/**
 * Explicit historical field repair proposals (#260 §9, #323).
 *
 * Conflicts and gaps outside evidence-only repair (#320) need a separately
 * authorized, inspectable proposal. An operator names one work and the exact new
 * value of each field from a bounded set; this module turns that request and the
 * current evidence into the proposal an administrator approves:
 *
 * - every change with its exact current value (`before`) and new value (`after`);
 * - the diagnostics findings touching the work, the operator's evidence note, and
 *   the findings that would remain afterwards (the remaining uncertainty);
 * - the approval, allocation, replay, payroll and audit consequences;
 * - the expected state of the work, which application re-reads under coordination.
 *
 * The fingerprint covers all of it, so any change to the work, its findings or its
 * receipts makes an approved proposal stale. The bounded fields exclude period
 * endpoints (they mirror hashed entries), approval state, deletion, links, ownership
 * and record creation. Work with a pending approval or correction is refused: that
 * review must resolve first. Nothing here writes.
 */
import { createHash } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import {
	compareInstants,
	type Instant,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { canonicalJson } from "./canonical-json";
import {
	REPAIRABLE_FIELDS,
	type RepairChangeField,
	type RepairChangeTarget,
	type RequestedRepairChange,
} from "./historical-repair-fields";
import {
	assessHistoricalWork,
	type HistoricalPeriodEvidence,
	type HistoricalRecordEvidence,
	type HistoricalWorkEvidence,
	type WorkFinding,
	type WorkFindingKind,
	type WorkFindingShape,
	type WorkFindingTreatment,
} from "./historical-work-diagnostics";
import { isWorkLocationType } from "./work-location";

export const HISTORICAL_REPAIR_PROPOSAL_VERSION = 1;

export {
	REPAIRABLE_FIELDS,
	type RepairChangeField,
	type RepairChangeTarget,
	type RequestedRepairChange,
} from "./historical-repair-fields";

export interface RepairChange {
	target: RepairChangeTarget;
	/** The changed row: the period, or its canonical record. */
	id: string;
	field: RepairChangeField;
	/** Canonical instant strings for endpoints. */
	before: string | number | null;
	after: string | number;
}

export type HistoricalRepairRefusal =
	| "work_not_found"
	| "work_deleted"
	| "work_active"
	| "approval_pending"
	| "correction_pending"
	| "record_missing"
	| "record_detail_missing"
	| "field_not_repairable"
	| "duplicate_field"
	| "invalid_value"
	| "no_change"
	| "interval_invalid"
	| "minutes_exceed_interval"
	| "reference_outside_organization";

export interface ProposalFinding {
	id: string;
	kind: WorkFindingKind;
	shape: WorkFindingShape;
	treatment: WorkFindingTreatment;
}

export interface HistoricalRepairExpectedState {
	period: {
		id: string;
		graphRevision: number;
		startTime: string;
		endTime: string | null;
		durationMinutes: number | null;
		approvalStatus: HistoricalPeriodEvidence["approvalStatus"];
		hasPendingChanges: boolean;
		canonicalRecordId: string | null;
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
	record: {
		id: string;
		startAt: string;
		endAt: string | null;
		durationMinutes: number | null;
		approvalState: HistoricalRecordEvidence["approvalState"];
		detail: { workCategoryId: string | null; workLocationType: string | null } | null;
		projectIds: string[];
	} | null;
}

export interface HistoricalRepairProposal {
	version: typeof HISTORICAL_REPAIR_PROPOSAL_VERSION;
	scope: { organizationId: string; employeeId: string };
	work: { workPeriodId: string; timeRecordId: string | null };
	changes: RepairChange[];
	evidence: { note: string; findings: ProposalFinding[] };
	uncertainty: { remainingFindings: ProposalFinding[] };
	consequences: {
		approval: {
			periodStatus: HistoricalPeriodEvidence["approvalStatus"];
			recordState: HistoricalRecordEvidence["approvalState"] | null;
			effects: ("approved_work_changes" | "rejected_work_changes" | "no_decision_recorded")[];
		};
		allocation: {
			projectIds: string[];
			effects: ("allocation_weights_unchanged" | "period_project_differs_from_record_allocation")[];
		};
		replay: { receiptIds: string[]; effects: ["committed_replay_returns_recorded_result"] };
		payroll: {
			effects: (
				| "payable_minutes_change"
				| "legacy_totals_change"
				| "finalized_exports_unchanged"
			)[];
		};
		audit: {
			receiptKind: "apply_historical_repair_proposal";
			writer: "historical_repair_proposal";
		};
	};
	expected: HistoricalRepairExpectedState;
}

export interface HistoricalRepairRequest {
	workPeriodId: string;
	changes: readonly RequestedRepairChange[];
	/** What establishes the new values; shown to the approver as evidence. */
	evidenceNote: string;
}

export type HistoricalRepairProposalResult =
	| { kind: "proposal"; proposal: HistoricalRepairProposal; fingerprint: string }
	| { kind: "refused"; reasons: HistoricalRepairRefusal[] };

export interface HistoricalRepairInput {
	/** The employee's evidence, read with an organization predicate. */
	evidence: HistoricalWorkEvidence;
	/** Organization-owned projects and categories the request references. */
	references: { projectIds: ReadonlySet<string>; workCategoryIds: ReadonlySet<string> };
	request: HistoricalRepairRequest;
}

const INTERVAL_FIELDS: ReadonlySet<RepairChangeField> = new Set([
	"start_at",
	"end_at",
	"duration_minutes",
]);

export function proposeHistoricalRepair(
	input: HistoricalRepairInput,
): HistoricalRepairProposalResult {
	const { evidence, references, request } = input;
	const period = evidence.periods.find((candidate) => candidate.id === request.workPeriodId);
	if (!period) return { kind: "refused", reasons: ["work_not_found"] };
	const record = representationOf(period, evidence.records);

	const reasons = new Set<HistoricalRepairRefusal>();
	if (period.deletedAt !== null) reasons.add("work_deleted");
	if (period.isActive || period.endTime === null) reasons.add("work_active");
	if (period.approvalStatus === "pending" || record?.approvalState === "pending") {
		reasons.add("approval_pending");
	}
	if (period.hasPendingChanges) reasons.add("correction_pending");
	if (request.changes.length === 0) reasons.add("no_change");

	const seen = new Set<string>();
	const changes: RepairChange[] = [];
	for (const requested of request.changes) {
		const key = `${requested.target}:${requested.field}`;
		if (seen.has(key)) reasons.add("duplicate_field");
		seen.add(key);
		if (!REPAIRABLE_FIELDS[requested.target]?.includes(requested.field)) {
			reasons.add("field_not_repairable");
			continue;
		}
		if (requested.target === "time_record" && !record) {
			reasons.add("record_missing");
			continue;
		}
		const after = normalizedAfter(requested, references);
		if (typeof after === "object") {
			reasons.add(after.refusal);
			continue;
		}
		const before = currentValue(requested, period, record);
		if (before === undefined) {
			reasons.add("record_detail_missing");
			continue;
		}
		if (before === after) reasons.add("no_change");
		changes.push({
			target: requested.target,
			id: requested.target === "time_record" ? (record as HistoricalRecordEvidence).id : period.id,
			field: requested.field,
			before,
			after,
		});
	}
	if (reasons.size === 0) {
		for (const refusal of resultingIntervalRefusals(period, record, changes)) reasons.add(refusal);
	}
	if (reasons.size > 0) return { kind: "refused", reasons: [...reasons] };

	const subjects = new Set([period.id, ...(record ? [record.id] : [])]);
	const findingsTouching = (findings: readonly WorkFinding[]) =>
		findings
			.filter((finding) =>
				[...finding.workPeriodIds, ...finding.timeRecordIds].some((id) => subjects.has(id)),
			)
			.map(({ id, kind, shape, treatment }) => ({ id, kind, shape, treatment }))
			.toSorted((left, right) => compareStrings(left.id, right.id));
	const scope = findingScope(period);
	const before = findingsTouching(assessHistoricalWork(evidence, scope).findings);
	const after = findingsTouching(
		assessHistoricalWork(applyToEvidence(evidence, period, record, changes), scope).findings,
	);

	const proposal: HistoricalRepairProposal = {
		version: HISTORICAL_REPAIR_PROPOSAL_VERSION,
		scope: { organizationId: evidence.organizationId, employeeId: period.employeeId },
		work: { workPeriodId: period.id, timeRecordId: record?.id ?? null },
		changes,
		evidence: { note: request.evidenceNote, findings: before },
		uncertainty: { remainingFindings: after },
		consequences: consequencesOf(evidence, period, record, changes),
		expected: expectedStateOf(period, record),
	};
	return { kind: "proposal", proposal, fingerprint: digest(canonicalJson(proposal)) };
}

/** The new value in stored form, or why it cannot be stored. */
function normalizedAfter(
	change: RequestedRepairChange,
	references: HistoricalRepairInput["references"],
): string | number | { refusal: HistoricalRepairRefusal } {
	switch (change.field) {
		case "start_at":
		case "end_at":
			try {
				return instantToCanonicalString(parseInstant(change.after));
			} catch {
				return { refusal: "invalid_value" };
			}
		case "duration_minutes":
			return Number.isSafeInteger(change.after) && change.after >= 0
				? change.after
				: { refusal: "invalid_value" };
		case "work_location_type":
			return isWorkLocationType(change.after) ? change.after : { refusal: "invalid_value" };
		case "work_category_id":
			return references.workCategoryIds.has(change.after)
				? change.after
				: { refusal: "reference_outside_organization" };
		case "project_id":
			return references.projectIds.has(change.after)
				? change.after
				: { refusal: "reference_outside_organization" };
	}
}

/** The stored value, or undefined when a record metadata change has no work detail. */
function currentValue(
	change: RequestedRepairChange,
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
): string | number | null | undefined {
	if (change.target === "work_period") {
		switch (change.field) {
			case "duration_minutes":
				return period.durationMinutes;
			case "work_category_id":
				return period.workCategoryId;
			case "work_location_type":
				return period.workLocationType;
			case "project_id":
				return period.projectId;
		}
	}
	if (!record) return undefined;
	switch (change.field) {
		case "start_at":
			return instantToCanonicalString(record.startAt);
		case "end_at":
			return record.endAt ? instantToCanonicalString(record.endAt) : null;
		case "duration_minutes":
			return record.durationMinutes;
		case "work_category_id":
			return record.detail ? record.detail.workCategoryId : undefined;
		case "work_location_type":
			return record.detail ? record.detail.workLocationType : undefined;
	}
	return undefined;
}

/**
 * A changed representation must keep a valid interval: start before end, and no
 * more stored minutes than its elapsed time (rounded up). Zero minutes stay valid.
 */
function resultingIntervalRefusals(
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
	changes: readonly RepairChange[],
): HistoricalRepairRefusal[] {
	const refusals: HistoricalRepairRefusal[] = [];
	const afterOf = (target: RepairChangeTarget, field: RepairChangeField) =>
		changes.find((change) => change.target === target && change.field === field)?.after;

	const check = (start: Instant, end: Instant | null, minutes: number | null) => {
		if (end === null) return;
		if (compareInstants(start, end) >= 0) {
			refusals.push("interval_invalid");
			return;
		}
		if (minutes !== null && minutes > Math.ceil(elapsedMinutes(start, end))) {
			refusals.push("minutes_exceed_interval");
		}
	};
	if (
		changes.some((change) => change.target === "work_period" && INTERVAL_FIELDS.has(change.field))
	) {
		check(
			period.startTime,
			period.endTime,
			(afterOf("work_period", "duration_minutes") as number | undefined) ?? period.durationMinutes,
		);
	}
	if (
		record &&
		changes.some((change) => change.target === "time_record" && INTERVAL_FIELDS.has(change.field))
	) {
		const start = afterOf("time_record", "start_at");
		const end = afterOf("time_record", "end_at");
		check(
			typeof start === "string" ? parseInstant(start) : record.startAt,
			typeof end === "string" ? parseInstant(end) : record.endAt,
			(afterOf("time_record", "duration_minutes") as number | undefined) ?? record.durationMinutes,
		);
	}
	return refusals;
}

/** The evidence as it would read after the changes; used only to show what remains. */
function applyToEvidence(
	evidence: HistoricalWorkEvidence,
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
	changes: readonly RepairChange[],
): HistoricalWorkEvidence {
	const changedPeriod: HistoricalPeriodEvidence = { ...period };
	const changedRecord: HistoricalRecordEvidence | null = record
		? { ...record, detail: record.detail ? { ...record.detail } : null }
		: null;
	for (const change of changes) {
		if (change.target === "work_period") {
			if (change.field === "duration_minutes")
				changedPeriod.durationMinutes = change.after as number;
			if (change.field === "work_category_id")
				changedPeriod.workCategoryId = change.after as string;
			if (change.field === "work_location_type") {
				changedPeriod.workLocationType = change.after as string;
			}
			if (change.field === "project_id") changedPeriod.projectId = change.after as string;
			continue;
		}
		if (!changedRecord) continue;
		if (change.field === "start_at") changedRecord.startAt = parseInstant(change.after as string);
		if (change.field === "end_at") changedRecord.endAt = parseInstant(change.after as string);
		if (change.field === "duration_minutes") changedRecord.durationMinutes = change.after as number;
		if (changedRecord.detail && change.field === "work_category_id") {
			changedRecord.detail.workCategoryId = change.after as string;
		}
		if (changedRecord.detail && change.field === "work_location_type") {
			changedRecord.detail.workLocationType = change.after as string;
		}
	}
	return {
		...evidence,
		periods: evidence.periods.map((candidate) =>
			candidate.id === period.id ? changedPeriod : candidate,
		),
		records: evidence.records.map((candidate) =>
			changedRecord && candidate.id === changedRecord.id ? changedRecord : candidate,
		),
	};
}

function consequencesOf(
	evidence: HistoricalWorkEvidence,
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
	changes: readonly RepairChange[],
): HistoricalRepairProposal["consequences"] {
	const recordInterval = changes.some(
		(change) => change.target === "time_record" && INTERVAL_FIELDS.has(change.field),
	);
	const periodMinutes = changes.some(
		(change) => change.target === "work_period" && change.field === "duration_minutes",
	);
	const intervalChanges = recordInterval || periodMinutes;
	const states = [period.approvalStatus, record?.approvalState];

	const approval: HistoricalRepairProposal["consequences"]["approval"]["effects"] = [];
	if (intervalChanges && states.includes("approved")) approval.push("approved_work_changes");
	if (intervalChanges && states.includes("rejected")) approval.push("rejected_work_changes");
	approval.push("no_decision_recorded");

	const projectIds = [...(record?.projectIds ?? [])].toSorted();
	const allocation: HistoricalRepairProposal["consequences"]["allocation"]["effects"] = [];
	if (recordInterval && projectIds.length > 0) allocation.push("allocation_weights_unchanged");
	const periodProject = changes.find(
		(change) => change.target === "work_period" && change.field === "project_id",
	);
	if (record && periodProject && !projectIds.includes(periodProject.after as string)) {
		allocation.push("period_project_differs_from_record_allocation");
	}

	const payroll: HistoricalRepairProposal["consequences"]["payroll"]["effects"] = [];
	if (recordInterval && record?.approvalState === "approved")
		payroll.push("payable_minutes_change");
	if (periodMinutes) payroll.push("legacy_totals_change");
	payroll.push("finalized_exports_unchanged");

	return {
		approval: {
			periodStatus: period.approvalStatus,
			recordState: record?.approvalState ?? null,
			effects: approval,
		},
		allocation: { projectIds, effects: allocation },
		replay: {
			receiptIds: evidence.operations
				.filter((operation) => operation.workPeriodId === period.id)
				.map((operation) => operation.id)
				.toSorted(),
			effects: ["committed_replay_returns_recorded_result"],
		},
		payroll: { effects: payroll },
		audit: {
			receiptKind: "apply_historical_repair_proposal",
			writer: "historical_repair_proposal",
		},
	};
}

function expectedStateOf(
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
): HistoricalRepairExpectedState {
	return {
		period: {
			id: period.id,
			graphRevision: period.graphRevision,
			startTime: instantToCanonicalString(period.startTime),
			endTime: period.endTime ? instantToCanonicalString(period.endTime) : null,
			durationMinutes: period.durationMinutes,
			approvalStatus: period.approvalStatus,
			hasPendingChanges: period.hasPendingChanges,
			canonicalRecordId: period.canonicalRecordId,
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
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

/** The period's canonical representation, following the diagnostics' identity rules. */
function representationOf(
	period: HistoricalPeriodEvidence,
	records: readonly HistoricalRecordEvidence[],
): HistoricalRecordEvidence | null {
	const id = period.canonicalRecordId ?? period.id;
	return (
		records.find((record) => record.id === id && record.employeeId === period.employeeId) ?? null
	);
}

/** A scope covering the work in every zone, so each finding touching it is reported. */
function findingScope(period: HistoricalPeriodEvidence) {
	const day = Temporal.Duration.from({ hours: 36 });
	return {
		employeeIds: [period.employeeId],
		range: {
			start: period.startTime.subtract(day),
			endExclusive: (period.endTime ?? period.startTime).add(day),
		},
	};
}

function elapsedMinutes(start: Instant, end: Instant): number {
	return (end.epochMilliseconds - start.epochMilliseconds) / 60_000;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
