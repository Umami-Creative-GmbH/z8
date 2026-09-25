/**
 * Read-only historical work diagnostics with scoped completeness (#260 §2/§4/§7/§8, #319).
 *
 * One assessment reads an organization's retained work evidence (legacy periods,
 * canonical records, endpoint entries, completed-work receipts and adoption
 * evidence) and reports record-level findings under the historical shape matrix:
 *
 * - `missing`: a representation lacks a value other evidence establishes; eligible
 *   for evidence-only repair (#320) only when its provenance is pre-adoption.
 * - `conflicting`: representations disagree; always a review case, even when one
 *   side looks more plausible.
 * - `suspected_defect`: historical manual-entry behavior (timezone interpretation,
 *   holiday dates, trimming) that evidence supports but that never changes an
 *   established interval by itself.
 * - `disclosure`: a limitation of the evidence that does not make work uncertain.
 *
 * Provenance comes from durable write evidence (receipts, admissions, row write
 * time), never from the date the work happened. Fresh post-adoption and backdated
 * writes are integrity incidents; ambiguous provenance needs investigation.
 *
 * Scoped completeness assesses every finding before approval, end-present or
 * employee filters could hide its work. Work whose dates or ownership cannot be
 * established widens to the employee or the organization. Append assurance is a
 * separate claim (`append-assurance.ts`) and never decides completeness here.
 *
 * Nothing here writes, repairs, derives a missing value or guesses intent.
 */
import { Temporal } from "temporal-polyfill";
import type { CompletedWorkOperationKind } from "@/db/schema/completed-work";
import {
	compareInstants,
	type Instant,
	instantToCanonicalString,
	parseInstant,
	parsePlainDate,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface HistoricalEntryEvidence {
	id: string;
	employeeId: string;
	type: string;
	timestamp: Instant;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
	isSuperseded: boolean;
	supersededById: string | null;
	/** The human who wrote the entry: evidence of that particular action only. */
	createdBy: string;
}

export interface HistoricalPeriodEvidence {
	id: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
	startTime: Instant;
	endTime: Instant | null;
	durationMinutes: number | null;
	isActive: boolean;
	approvalStatus: "pending" | "approved" | "rejected";
	hasPendingChanges: boolean;
	/** Whether a legacy approval request names this period (before workflow links existed). */
	hasApprovalRequest: boolean;
	approvalWorkflowId: string | null;
	deletedAt: Instant | null;
	projectId: string | null;
	workCategoryId: string | null;
	workLocationType: string | null;
	canonicalRecordId: string | null;
	/** Explicit work-graph revision (#256 §6); repairs expect it unchanged. */
	graphRevision: number;
	/** Row write time: write evidence, never the work date. */
	createdAt: Instant;
}

export interface HistoricalRecordEvidence {
	id: string;
	employeeId: string;
	startAt: Instant;
	endAt: Instant | null;
	durationMinutes: number | null;
	approvalState: "draft" | "pending" | "approved" | "rejected";
	origin: string;
	createdAt: Instant;
	detail: {
		workCategoryId: string | null;
		workLocationType: string | null;
		computationMetadata: string | null;
	} | null;
	projectIds: readonly string[];
}

export interface HistoricalOperationEvidence {
	id: string;
	employeeId: string;
	kind: CompletedWorkOperationKind;
	writer: string;
	writerVersion: number;
	appendAdmission: "legacy" | "append";
	workPeriodId: string;
	createdAt: Instant;
}

export interface HistoricalAdoptionEvidence {
	/** The organization's append control; its `updatedAt` is the activation evidence. */
	control: { mode: "inactive" | "active"; updatedAt: Instant } | null;
	/** Admission instant of each employee's append position. */
	admissions: ReadonlyMap<string, Instant>;
}

/** Work in the organization whose owner is not one of its employees. */
export interface ForeignOwnedWork {
	kind: "work_period" | "time_record";
	id: string;
}

export interface HistoricalWorkEvidence {
	organizationId: string;
	periods: readonly HistoricalPeriodEvidence[];
	records: readonly HistoricalRecordEvidence[];
	entries: readonly HistoricalEntryEvidence[];
	operations: readonly HistoricalOperationEvidence[];
	adoption: HistoricalAdoptionEvidence;
	foreignOwnedWork: readonly ForeignOwnedWork[];
}

export interface HistoricalWorkScope {
	employeeIds: readonly string[];
	range: { start: Instant; endExclusive: Instant };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type WorkFindingKind =
	| "ownership_conflict"
	| "work_outside_organization_employees"
	| "canonical_missing"
	| "canonical_link_missing"
	| "canonical_link_unresolved"
	| "canonical_link_shared"
	| "canonical_detail_missing"
	| "relinked_canonical_residue"
	| "endpoint_missing"
	| "endpoint_conflict"
	| "open_state_conflict"
	| "multiple_active_work"
	| "endpoint_entry_unresolved"
	| "endpoint_entry_superseded"
	| "endpoint_entry_missing"
	| "capture_inferred"
	| "duration_missing"
	| "duration_conflict"
	| "negative_duration"
	| "reversed_interval"
	| "empty_interval"
	| "stored_elapsed_discrepancy"
	| "deleted_work_payable"
	| "metadata_missing"
	| "metadata_conflict"
	| "metadata_canonical_only"
	| "approval_state_conflict"
	| "approval_relationship_missing"
	| "overlapping_work"
	| "manual_evidence_unreadable"
	| "manual_zone_unrecorded"
	| "manual_interpretation_ambiguous"
	| "manual_interpretation_mismatch"
	| "manual_trimmed"
	| "manual_holiday_check_dates_differ";

export type WorkFindingShape = "missing" | "conflicting" | "suspected_defect" | "disclosure";

export type WorkFindingTreatment =
	/** Pre-adoption missing value: eligible for evidence-only repair (#320). */
	| "historical_gap"
	/** Pre-adoption conflict or suspected defect: separately authorized review. */
	| "review_required"
	/** Fresh write that should have satisfied the completed-work invariant. */
	| "integrity_incident"
	| "investigation_required"
	| "disclosed";

export type AdoptionProvenance =
	| {
			state: "pre_adoption";
			basis: "organization_not_adopted" | "written_before_admission" | "legacy_admission_receipt";
	  }
	| { state: "fresh_backdated"; operationId: string; writer: string; admittedAt: string }
	| { state: "post_adoption"; operationId: string; writer: string }
	| {
			state: "ambiguous";
			reason:
				| "written_after_admission_without_receipt"
				| "legacy_receipt_after_admission"
				| "amended_after_admission"
				| "ownership_unestablished";
	  };

export type FindingRelevance =
	/** `end: null` when the end is unknown: relevant to every later scope. */
	| { level: "interval"; start: string; end: string | null }
	/** Dates cannot be established: relevant to every scope of these employees. */
	| { level: "employee" }
	/** Ownership cannot be established: relevant to every scope. */
	| { level: "organization" };

export type FindingDetails = Record<string, string | number | boolean | null | string[]>;

export interface WorkFinding {
	/** Stable across reads of the same evidence. */
	id: string;
	kind: WorkFindingKind;
	shape: WorkFindingShape;
	treatment: WorkFindingTreatment;
	/** Whether the finding makes work in its relevance uncertain. */
	blocking: boolean;
	employeeIds: string[];
	workPeriodIds: string[];
	timeRecordIds: string[];
	entryIds: string[];
	provenance: AdoptionProvenance;
	relevance: FindingRelevance;
	/** Whether the relevance intersects the requested scope. */
	relevant: boolean;
	details: FindingDetails;
}

export type CompletenessWidening = "requested" | "employees" | "organization";

export interface HistoricalWorkDiagnostics {
	organizationId: string;
	scope: { employeeIds: string[]; range: { start: string; endExclusive: string } };
	completeness: {
		/** `incomplete`: diagnostic reads may show unaffected data with this marker. */
		status: "complete" | "incomplete";
		widenedTo: CompletenessWidening;
		affectedEmployeeIds: string[];
		blockingFindingIds: string[];
	};
	/** Findings relevant to the requested scope, ordered by kind and ID. */
	findings: WorkFinding[];
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

const HISTORICAL_REPAIR_OPERATION_KINDS: ReadonlySet<CompletedWorkOperationKind> = new Set([
	"repair_historical_gap",
	"apply_historical_repair_proposal",
]);

const CREATING_OPERATION_KINDS: ReadonlySet<CompletedWorkOperationKind> = new Set([
	"close_active_work",
	"start_live_work",
	"import_completed_work",
	"import_open_work",
	"create_completed_work",
]);

/** Capture sources recorded at the event; the others were inferred later. */
const CONTEMPORANEOUS_CAPTURE_SOURCES: ReadonlySet<string> = new Set([
	"browser",
	"user_setting",
	"manager_target_user_setting",
]);

/** Largest local-day offsets from UTC; every zone's calendar date fits inside. */
const EARLIEST_OFFSET = { hours: 14 };
const LATEST_OFFSET = { hours: 14 };

/**
 * UTC instants covering the inclusive calendar dates in every time zone, so a
 * diagnostic scope never depends on the viewer's or an employee's zone.
 */
export function calendarDateEnvelope(startDate: string, endDateInclusive: string) {
	const start = parsePlainDate(startDate).toZonedDateTime("UTC").toInstant();
	const end = parsePlainDate(endDateInclusive).add({ days: 1 }).toZonedDateTime("UTC").toInstant();
	return {
		start: start.subtract(EARLIEST_OFFSET),
		endExclusive: end.add(LATEST_OFFSET),
	};
}

type Draft = Omit<
	WorkFinding,
	| "id"
	| "treatment"
	| "blocking"
	| "relevant"
	| "provenance"
	| "employeeIds"
	| "workPeriodIds"
	| "timeRecordIds"
	| "entryIds"
	| "details"
> & {
	employeeIds?: readonly string[];
	workPeriodIds?: readonly string[];
	timeRecordIds?: readonly string[];
	entryIds?: readonly string[];
	provenance: AdoptionProvenance;
	details?: FindingDetails;
	/** Distinguishes findings of one kind on the same subjects. */
	discriminator?: string;
	blocking?: boolean;
};

const NON_BLOCKING_KINDS: ReadonlySet<WorkFindingKind> = new Set(["endpoint_entry_missing"]);

export function assessHistoricalWork(
	evidence: HistoricalWorkEvidence,
	scope: HistoricalWorkScope,
): HistoricalWorkDiagnostics {
	const drafts: Draft[] = [];
	const entriesById = new Map(evidence.entries.map((entry) => [entry.id, entry]));
	const recordsById = new Map(evidence.records.map((record) => [record.id, record]));
	const periodsById = new Map(evidence.periods.map((period) => [period.id, period]));
	const operationsByPeriod = groupBy(evidence.operations, (operation) => operation.workPeriodId);
	const provenance = provenanceResolver(evidence.adoption, operationsByPeriod);

	// Each canonical record is either one period's representation or native work.
	const linkingPeriods = groupBy(
		evidence.periods.filter((period) => period.canonicalRecordId !== null),
		(period) => period.canonicalRecordId as string,
	);
	const representationOf = new Map<string, HistoricalRecordEvidence>();
	for (const period of evidence.periods) {
		const linked = period.canonicalRecordId ? recordsById.get(period.canonicalRecordId) : undefined;
		if (linked) representationOf.set(period.id, linked);
	}
	const implicitlyLinked = new Set<string>();
	const residueRecords = new Set<string>();
	for (const record of evidence.records) {
		if (linkingPeriods.has(record.id)) continue;
		const sameId = periodsById.get(record.id);
		if (!sameId) continue;
		if (sameId.canonicalRecordId === null) {
			implicitlyLinked.add(record.id);
			representationOf.set(sameId.id, record);
		} else {
			residueRecords.add(record.id);
		}
	}

	for (const [recordId, periods] of linkingPeriods) {
		if (periods.length < 2 || !recordsById.has(recordId)) continue;
		drafts.push({
			kind: "canonical_link_shared",
			shape: "conflicting",
			employeeIds: periods.map((period) => period.employeeId),
			workPeriodIds: periods.map((period) => period.id),
			timeRecordIds: [recordId],
			provenance: worstProvenance(periods.map((period) => provenance.ofPeriod(period))),
			relevance: intervalRelevance(periods.map(periodInterval)),
		});
	}

	for (const period of evidence.periods) {
		const periodProvenance = provenance.ofPeriod(period);
		const record = representationOf.get(period.id) ?? null;
		const push = (draft: Omit<Draft, "provenance"> & { provenance?: AdoptionProvenance }) =>
			drafts.push({
				employeeIds: [period.employeeId],
				workPeriodIds: [period.id],
				...draft,
				provenance: draft.provenance ?? periodProvenance,
			});

		if (period.deletedAt !== null) {
			// Deletion evidence is preserved; only a payable representation is a finding.
			if (record && record.endAt !== null && compareInstants(record.endAt, record.startAt) !== 0) {
				push({
					kind: "deleted_work_payable",
					shape: "conflicting",
					timeRecordIds: [record.id],
					relevance: intervalRelevance([recordInterval(record)]),
					details: { canonicalState: record.approvalState },
				});
			}
			continue;
		}

		const intervals = [periodInterval(period), ...(record ? [recordInterval(record)] : [])];
		const relevance = intervalRelevance(intervals);

		if (period.canonicalRecordId === null && !record) {
			push({ kind: "canonical_missing", shape: "missing", relevance });
		} else if (period.canonicalRecordId !== null && !record) {
			push({
				kind: "canonical_link_unresolved",
				shape: "conflicting",
				timeRecordIds: [period.canonicalRecordId],
				relevance: { level: "employee" },
			});
		} else if (record && implicitlyLinked.has(record.id)) {
			push({
				kind: "canonical_link_missing",
				shape: "missing",
				timeRecordIds: [record.id],
				relevance,
			});
		}

		const residue = residueRecords.has(period.id) ? recordsById.get(period.id) : undefined;
		if (residue) {
			push({
				kind: "relinked_canonical_residue",
				shape: "conflicting",
				employeeIds: [period.employeeId, residue.employeeId],
				timeRecordIds: [residue.id],
				relevance: intervalRelevance([...intervals, recordInterval(residue)]),
				details: { currentCanonicalRecordId: period.canonicalRecordId },
			});
		}

		// Endpoint entries.
		const endpointEntries: HistoricalEntryEvidence[] = [];
		for (const side of ["start", "end"] as const) {
			const entryId = side === "start" ? period.clockInId : period.clockOutId;
			const instant = side === "start" ? period.startTime : period.endTime;
			if (entryId === null) {
				if (side === "end" && instant !== null) {
					push({
						kind: "endpoint_entry_missing",
						shape: "missing",
						relevance,
						details: { side },
					});
				}
				continue;
			}
			const endpoint = entriesById.get(entryId);
			if (!endpoint) {
				push({
					kind: "endpoint_entry_unresolved",
					shape: "conflicting",
					entryIds: [entryId],
					relevance,
					details: { side },
					discriminator: side,
				});
				continue;
			}
			endpointEntries.push(endpoint);
			if (endpoint.isSuperseded) {
				push({
					kind: "endpoint_entry_superseded",
					shape: "conflicting",
					entryIds: [endpoint.id],
					relevance,
					details: { side, supersededById: endpoint.supersededById },
					discriminator: side,
				});
			}
			if (instant !== null && compareInstants(endpoint.timestamp, instant) !== 0) {
				push({
					kind: "endpoint_conflict",
					shape: "conflicting",
					entryIds: [endpoint.id],
					relevance: intervalRelevance([
						...intervals,
						{ start: endpoint.timestamp, end: endpoint.timestamp },
					]),
					details: {
						side,
						source: "entry",
						periodInstant: instantToCanonicalString(instant),
						otherInstant: instantToCanonicalString(endpoint.timestamp),
					},
					discriminator: `${side}:entry`,
				});
			}
			if (!CONTEMPORANEOUS_CAPTURE_SOURCES.has(endpoint.timezoneSource)) {
				push({
					kind: "capture_inferred",
					shape: "disclosure",
					entryIds: [endpoint.id],
					relevance,
					details: { side, timezoneSource: endpoint.timezoneSource },
					discriminator: side,
				});
			}
		}

		// Ownership.
		const owners = new Set([
			period.employeeId,
			...(record ? [record.employeeId] : []),
			...endpointEntries.map((endpoint) => endpoint.employeeId),
		]);
		if (owners.size > 1) {
			push({
				kind: "ownership_conflict",
				shape: "conflicting",
				employeeIds: [...owners],
				timeRecordIds: record ? [record.id] : [],
				entryIds: endpointEntries.map((endpoint) => endpoint.id),
				relevance,
			});
		}

		// Open, closed and active state.
		const periodClosed = period.endTime !== null;
		if (!periodClosed && !period.isActive) {
			push({
				kind: "endpoint_missing",
				shape: "missing",
				relevance,
				details: { side: "period_end" },
			});
		} else if (periodClosed && period.isActive) {
			push({
				kind: "open_state_conflict",
				shape: "conflicting",
				relevance,
				details: { state: "active_with_end" },
			});
		} else if (!periodClosed && record && record.endAt !== null) {
			push({
				kind: "open_state_conflict",
				shape: "conflicting",
				timeRecordIds: [record.id],
				relevance,
				details: { state: "canonical_closed_period_open" },
			});
		}
		if (periodClosed && record && record.endAt === null) {
			push({
				kind: "endpoint_missing",
				shape: "missing",
				timeRecordIds: [record.id],
				relevance,
				details: { side: "canonical_end" },
			});
		}

		if (record) {
			for (const side of ["start", "end"] as const) {
				const periodInstant = side === "start" ? period.startTime : period.endTime;
				const recordInstant = side === "start" ? record.startAt : record.endAt;
				if (
					periodInstant !== null &&
					recordInstant !== null &&
					compareInstants(periodInstant, recordInstant) !== 0
				) {
					push({
						kind: "endpoint_conflict",
						shape: "conflicting",
						timeRecordIds: [record.id],
						relevance,
						details: {
							side,
							source: "canonical",
							periodInstant: instantToCanonicalString(periodInstant),
							otherInstant: instantToCanonicalString(recordInstant),
						},
						discriminator: `${side}:canonical`,
					});
				}
			}
			if (record.detail === null) {
				push({
					kind: "canonical_detail_missing",
					shape: "missing",
					timeRecordIds: [record.id],
					relevance,
				});
			}
		}

		// Durations and interval shape.
		pushIntervalShape(period.startTime, period.endTime, period.durationMinutes, (draft) =>
			push({ ...draft, relevance, details: { ...draft.details, source: "period" } }),
		);
		if (record) {
			if (periodClosed && record.endAt !== null && record.durationMinutes === null) {
				push({
					kind: "duration_missing",
					shape: "missing",
					timeRecordIds: [record.id],
					relevance,
					details: { source: "canonical" },
					discriminator: "canonical",
				});
			}
			if (
				period.durationMinutes !== null &&
				record.durationMinutes !== null &&
				period.durationMinutes !== record.durationMinutes
			) {
				push({
					kind: "duration_conflict",
					shape: "conflicting",
					timeRecordIds: [record.id],
					relevance,
					details: {
						periodMinutes: period.durationMinutes,
						canonicalMinutes: record.durationMinutes,
					},
				});
			}
		}

		// Metadata: omission, clearing and replacement are distinct.
		if (record?.detail) {
			const detail = record.detail;
			const compare = (
				field: string,
				periodValue: string | null,
				canonicalValues: readonly string[],
			) => {
				const common = { timeRecordIds: [record.id], relevance, discriminator: field };
				if (periodValue !== null && canonicalValues.length === 0) {
					push({
						...common,
						kind: "metadata_missing",
						shape: "missing",
						details: { field, periodValue },
					});
				} else if (periodValue !== null && !canonicalValues.includes(periodValue)) {
					push({
						...common,
						kind: "metadata_conflict",
						shape: "conflicting",
						details: { field, periodValue, canonicalValues: [...canonicalValues] },
					});
				} else if (periodValue === null && canonicalValues.length > 0) {
					push({
						...common,
						kind: "metadata_canonical_only",
						shape: "disclosure",
						details: { field, canonicalValues: [...canonicalValues] },
					});
				}
			};
			compare("project", period.projectId, record.projectIds);
			compare("work_category", period.workCategoryId, nonNull(detail.workCategoryId));
			compare("work_location_type", period.workLocationType, nonNull(detail.workLocationType));
		}

		// Approval relationships and state.
		if (record && record.approvalState !== period.approvalStatus) {
			push({
				kind: "approval_state_conflict",
				shape: "conflicting",
				timeRecordIds: [record.id],
				relevance,
				details: { periodState: period.approvalStatus, canonicalState: record.approvalState },
			});
		}
		if (
			period.approvalStatus === "pending" &&
			!period.hasPendingChanges &&
			!period.hasApprovalRequest &&
			period.approvalWorkflowId === null
		) {
			push({ kind: "approval_relationship_missing", shape: "missing", relevance });
		}

		if (record) {
			for (const draft of diagnoseManualSubmission(record, endpointEntries)) {
				push({ ...draft, timeRecordIds: [record.id], relevance });
			}
		}
	}

	// Canonical-native work is validated on its own evidence.
	const nativeRecords = evidence.records.filter(
		(record) =>
			!linkingPeriods.has(record.id) &&
			!implicitlyLinked.has(record.id) &&
			!residueRecords.has(record.id),
	);
	for (const record of nativeRecords) {
		const relevance = intervalRelevance([recordInterval(record)]);
		const push = (draft: Omit<Draft, "provenance">) =>
			drafts.push({
				employeeIds: [record.employeeId],
				timeRecordIds: [record.id],
				provenance: provenance.ofRecord(record),
				...draft,
			});
		pushIntervalShape(record.startAt, record.endAt, record.durationMinutes, (draft) =>
			push({ ...draft, relevance, details: { ...draft.details, source: "canonical" } }),
		);
		if (record.detail === null) {
			push({ kind: "canonical_detail_missing", shape: "missing", relevance });
		}
		for (const draft of diagnoseManualSubmission(record, [])) push({ ...draft, relevance });
	}

	// Occupancy: every nondeleted period and native record is one segment.
	type Segment = {
		employeeId: string;
		start: Instant;
		end: Instant | null;
		periodId?: string;
		recordId?: string;
		provenance: AdoptionProvenance;
	};
	const segments: Segment[] = [
		...evidence.periods
			.filter((period) => period.deletedAt === null)
			.map((period) => ({
				employeeId: period.employeeId,
				start: period.startTime,
				end: period.endTime,
				periodId: period.id,
				provenance: provenance.ofPeriod(period),
			})),
		...nativeRecords.map((record) => ({
			employeeId: record.employeeId,
			start: record.startAt,
			end: record.endAt,
			recordId: record.id,
			provenance: provenance.ofRecord(record),
		})),
	].filter((segment) => segment.end === null || compareInstants(segment.end, segment.start) > 0);
	for (const [employeeId, employeeSegments] of groupBy(segments, (segment) => segment.employeeId)) {
		const ordered = employeeSegments.toSorted((left, right) =>
			compareInstants(left.start, right.start),
		);
		const active = evidence.periods.filter(
			(period) => period.employeeId === employeeId && period.deletedAt === null && period.isActive,
		);
		if (active.length > 1) {
			drafts.push({
				kind: "multiple_active_work",
				shape: "conflicting",
				employeeIds: [employeeId],
				workPeriodIds: active.map((period) => period.id),
				provenance: worstProvenance(active.map((period) => provenance.ofPeriod(period))),
				relevance: intervalRelevance(active.map(periodInterval)),
			});
		}
		for (let index = 0; index < ordered.length; index += 1) {
			const left = ordered[index];
			for (let next = index + 1; next < ordered.length; next += 1) {
				const right = ordered[next];
				if (left.end !== null && compareInstants(right.start, left.end) >= 0) break;
				drafts.push({
					kind: "overlapping_work",
					shape: "conflicting",
					employeeIds: [employeeId],
					workPeriodIds: [left.periodId, right.periodId].filter(isString),
					timeRecordIds: [left.recordId, right.recordId].filter(isString),
					provenance: worstProvenance([left.provenance, right.provenance]),
					relevance: intervalRelevance([
						{ start: left.start, end: left.end },
						{ start: right.start, end: right.end },
					]),
				});
			}
		}
	}

	for (const work of evidence.foreignOwnedWork) {
		drafts.push({
			kind: "work_outside_organization_employees",
			shape: "conflicting",
			employeeIds: [],
			...(work.kind === "work_period"
				? { workPeriodIds: [work.id] }
				: { timeRecordIds: [work.id] }),
			provenance: { state: "ambiguous", reason: "ownership_unestablished" },
			relevance: { level: "organization" },
		});
	}

	return composeReport(evidence.organizationId, scope, drafts);
}

function composeReport(
	organizationId: string,
	scope: HistoricalWorkScope,
	drafts: readonly Draft[],
): HistoricalWorkDiagnostics {
	const scopeEmployees = new Set(scope.employeeIds);
	const byId = new Map<string, WorkFinding>();
	for (const draft of drafts) {
		const finding = finalize(draft, scopeEmployees, scope.range);
		if (finding.relevant && !byId.has(finding.id)) byId.set(finding.id, finding);
	}
	const findings = [...byId.values()].toSorted((left, right) =>
		left.kind === right.kind
			? compareStrings(left.id, right.id)
			: compareStrings(left.kind, right.kind),
	);
	const blocking = findings.filter((finding) => finding.blocking);
	const widenedTo: CompletenessWidening = blocking.some(
		(finding) => finding.relevance.level === "organization",
	)
		? "organization"
		: blocking.some((finding) => finding.relevance.level === "employee")
			? "employees"
			: "requested";
	return {
		organizationId,
		scope: {
			employeeIds: [...scopeEmployees].toSorted(),
			range: {
				start: instantToCanonicalString(scope.range.start),
				endExclusive: instantToCanonicalString(scope.range.endExclusive),
			},
		},
		completeness: {
			status: blocking.length > 0 ? "incomplete" : "complete",
			widenedTo,
			affectedEmployeeIds: sortedUnique(blocking.flatMap((finding) => finding.employeeIds)),
			blockingFindingIds: blocking.map((finding) => finding.id),
		},
		findings,
	};
}

function finalize(
	draft: Draft,
	scopeEmployees: ReadonlySet<string>,
	range: HistoricalWorkScope["range"],
): WorkFinding {
	const employeeIds = sortedUnique(draft.employeeIds ?? []);
	const workPeriodIds = sortedUnique(draft.workPeriodIds ?? []);
	const timeRecordIds = sortedUnique(draft.timeRecordIds ?? []);
	const entryIds = sortedUnique(draft.entryIds ?? []);
	const blocking =
		draft.blocking ??
		((draft.shape === "missing" || draft.shape === "conflicting") &&
			!NON_BLOCKING_KINDS.has(draft.kind));
	return {
		id: [draft.kind, ...workPeriodIds, ...timeRecordIds, ...entryIds, draft.discriminator ?? ""]
			.join(":")
			.replace(/:$/, ""),
		kind: draft.kind,
		shape: draft.shape,
		treatment: treatmentOf(draft.shape, draft.provenance),
		blocking,
		employeeIds,
		workPeriodIds,
		timeRecordIds,
		entryIds,
		provenance: draft.provenance,
		relevance: draft.relevance,
		relevant: isRelevant(draft.relevance, employeeIds, scopeEmployees, range),
		details: draft.details ?? {},
	};
}

function treatmentOf(
	shape: WorkFindingShape,
	provenance: AdoptionProvenance,
): WorkFindingTreatment {
	if (shape === "disclosure") return "disclosed";
	switch (provenance.state) {
		case "post_adoption":
		case "fresh_backdated":
			return "integrity_incident";
		case "ambiguous":
			return "investigation_required";
		case "pre_adoption":
			return shape === "missing" ? "historical_gap" : "review_required";
	}
}

function isRelevant(
	relevance: FindingRelevance,
	employeeIds: readonly string[],
	scopeEmployees: ReadonlySet<string>,
	range: HistoricalWorkScope["range"],
): boolean {
	if (relevance.level === "organization") return true;
	if (!employeeIds.some((employeeId) => scopeEmployees.has(employeeId))) return false;
	if (relevance.level === "employee") return true;
	const start = parseInstant(relevance.start);
	if (compareInstants(start, range.endExclusive) >= 0) return false;
	if (relevance.end === null) return true;
	const end = parseInstant(relevance.end);
	// A point (empty interval) inside the range is relevant too.
	return (
		compareInstants(end, range.start) > 0 ||
		(compareInstants(end, start) === 0 && compareInstants(start, range.start) >= 0)
	);
}

type Interval = { start: Instant; end: Instant | null };

function periodInterval(period: HistoricalPeriodEvidence): Interval {
	return { start: period.startTime, end: period.endTime };
}

function recordInterval(record: HistoricalRecordEvidence): Interval {
	return { start: record.startAt, end: record.endAt };
}

/** Hull of every representation's interval; reversed intervals count by both ends. */
function intervalRelevance(intervals: readonly Interval[]): FindingRelevance {
	const instants = intervals.flatMap((interval) =>
		interval.end === null ? [interval.start] : [interval.start, interval.end],
	);
	const ordered = instants.toSorted(compareInstants);
	const open = intervals.some((interval) => interval.end === null);
	return {
		level: "interval",
		start: instantToCanonicalString(ordered[0]),
		end: open ? null : instantToCanonicalString(ordered[ordered.length - 1]),
	};
}

function pushIntervalShape(
	start: Instant,
	end: Instant | null,
	minutes: number | null,
	push: (draft: {
		kind: WorkFindingKind;
		shape: WorkFindingShape;
		details: FindingDetails;
	}) => void,
) {
	if (minutes !== null && minutes < 0) {
		push({ kind: "negative_duration", shape: "conflicting", details: { minutes } });
	}
	if (end === null) return;
	const order = compareInstants(end, start);
	if (order < 0) {
		push({ kind: "reversed_interval", shape: "conflicting", details: {} });
		return;
	}
	if (order === 0) {
		push({ kind: "empty_interval", shape: "conflicting", details: {} });
		return;
	}
	if (minutes === null) {
		push({ kind: "duration_missing", shape: "missing", details: {} });
		return;
	}
	const elapsedSeconds = Number(
		(end.epochNanoseconds - start.epochNanoseconds) / BigInt(1_000_000_000),
	);
	const elapsedMinutes = Math.floor((elapsedSeconds + 30) / 60);
	if (minutes >= 0 && Math.abs(minutes - elapsedMinutes) > 1) {
		push({
			kind: "stored_elapsed_discrepancy",
			shape: "disclosure",
			details: { storedMinutes: minutes, elapsedSeconds },
		});
	}
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

const PROVENANCE_RANK: Record<AdoptionProvenance["state"], number> = {
	pre_adoption: 0,
	ambiguous: 1,
	fresh_backdated: 2,
	post_adoption: 3,
};

function worstProvenance(values: readonly AdoptionProvenance[]): AdoptionProvenance {
	return values.reduce((worst, value) =>
		PROVENANCE_RANK[value.state] > PROVENANCE_RANK[worst.state] ? value : worst,
	);
}

function provenanceResolver(
	adoption: HistoricalAdoptionEvidence,
	operationsByPeriod: ReadonlyMap<string, HistoricalOperationEvidence[]>,
) {
	const adoptionPoint = (employeeId: string): Instant | null =>
		adoption.admissions.get(employeeId) ??
		(adoption.control?.mode === "active" ? adoption.control.updatedAt : null);

	const withoutReceipt = (
		employeeId: string,
		createdAt: Instant,
		amendedUnderAppend: boolean,
	): AdoptionProvenance => {
		const point = adoptionPoint(employeeId);
		if (point === null) return { state: "pre_adoption", basis: "organization_not_adopted" };
		if (compareInstants(createdAt, point) >= 0) {
			return { state: "ambiguous", reason: "written_after_admission_without_receipt" };
		}
		return amendedUnderAppend
			? { state: "ambiguous", reason: "amended_after_admission" }
			: { state: "pre_adoption", basis: "written_before_admission" };
	};

	return {
		ofPeriod(period: HistoricalPeriodEvidence): AdoptionProvenance {
			const operations = (operationsByPeriod.get(period.id) ?? []).toSorted((left, right) =>
				compareInstants(left.createdAt, right.createdAt),
			);
			const creating = operations.find((operation) => CREATING_OPERATION_KINDS.has(operation.kind));
			const point = adoptionPoint(period.employeeId);
			if (!creating) {
				// Historical repairs (#320 evidence-only, #323 authorized proposals) correct
				// pre-adoption history under their own receipts; they are not amendments.
				return withoutReceipt(
					period.employeeId,
					period.createdAt,
					operations.some(
						(operation) =>
							operation.appendAdmission === "append" &&
							!HISTORICAL_REPAIR_OPERATION_KINDS.has(operation.kind),
					),
				);
			}
			if (creating.appendAdmission === "legacy") {
				return point === null || compareInstants(creating.createdAt, point) < 0
					? { state: "pre_adoption", basis: "legacy_admission_receipt" }
					: { state: "ambiguous", reason: "legacy_receipt_after_admission" };
			}
			return point !== null && compareInstants(period.startTime, point) < 0
				? {
						state: "fresh_backdated",
						operationId: creating.id,
						writer: creating.writer,
						admittedAt: instantToCanonicalString(point),
					}
				: { state: "post_adoption", operationId: creating.id, writer: creating.writer };
		},
		ofRecord(record: HistoricalRecordEvidence): AdoptionProvenance {
			return withoutReceipt(record.employeeId, record.createdAt, false);
		},
	};
}

// ---------------------------------------------------------------------------
// Historical manual entries (#260 §8)
// ---------------------------------------------------------------------------

const MANUAL_SUBMISSION_MARKER = "manual_time_submission";

type ManualSubmissionEvidence = {
	request: {
		date: string;
		clockInTime: string;
		clockOutTime: string;
		timezone: string | null;
	};
	result: { startTime: string; endTime: string; wasAdjusted: boolean };
};

type ManualDraft = {
	kind: WorkFindingKind;
	shape: WorkFindingShape;
	details: FindingDetails;
	discriminator?: string;
};

/**
 * Legacy manual submissions (#254) kept their request and result in the canonical
 * work detail. Their interpretation zone was the request's zone or, without one,
 * the target's saved zone, which the endpoint capture recorded at submission.
 * Diagnoses compare that evidence with the persisted result; intent that the
 * evidence does not record is reported as unrecoverable, never chosen.
 */
function diagnoseManualSubmission(
	record: HistoricalRecordEvidence,
	endpointEntries: readonly HistoricalEntryEvidence[],
): ManualDraft[] {
	const metadata = record.detail?.computationMetadata ?? null;
	if (
		record.origin !== "manual" ||
		metadata === null ||
		!metadata.includes(MANUAL_SUBMISSION_MARKER)
	) {
		return [];
	}
	const submission = parseManualSubmission(metadata);
	if (!submission) {
		return [{ kind: "manual_evidence_unreadable", shape: "conflicting", details: {} }];
	}
	const { request, result } = submission;
	const capture = endpointEntries.find(
		(entry) =>
			entry.type === "clock_in" &&
			entry.timezone !== null &&
			CONTEMPORANEOUS_CAPTURE_SOURCES.has(entry.timezoneSource),
	);
	const zone = request.timezone ?? capture?.timezone ?? null;
	const zoneBasis = request.timezone !== null ? "request" : "capture";
	if (zone === null || !isValidIanaTimeZone(zone)) {
		// Intent is unrecoverable: a reviewer must ask for human evidence.
		return [{ kind: "manual_zone_unrecorded", shape: "suspected_defect", details: {} }];
	}

	const clockIn = interpretWallTime(request.date, request.clockInTime, zone);
	const clockOut = interpretWallTime(request.date, request.clockOutTime, zone);
	for (const [endpoint, interpretation] of [
		["clock_in", clockIn],
		["clock_out", clockOut],
	] as const) {
		if (interpretation.kind !== "exact") {
			return [
				{
					kind: "manual_interpretation_ambiguous",
					shape: "suspected_defect",
					details: { zone, zoneBasis, endpoint, ambiguity: interpretation.kind },
				},
			];
		}
	}
	if (clockIn.kind !== "exact" || clockOut.kind !== "exact") return [];

	const submitted = {
		submittedStart: instantToCanonicalString(clockIn.instant),
		submittedEnd: instantToCanonicalString(clockOut.instant),
	};
	const persistedStart = parseInstant(result.startTime);
	const persistedEnd = parseInstant(result.endTime);
	const persisted = {
		persistedStart: instantToCanonicalString(persistedStart),
		persistedEnd: instantToCanonicalString(persistedEnd),
	};
	const drafts: ManualDraft[] = [];
	if (result.wasAdjusted) {
		drafts.push({
			kind: "manual_trimmed",
			shape: "suspected_defect",
			details: { zone, zoneBasis, ...submitted, ...persisted },
		});
	} else if (
		compareInstants(clockIn.instant, persistedStart) !== 0 ||
		compareInstants(clockOut.instant, persistedEnd) !== 0
	) {
		return [
			{
				kind: "manual_interpretation_mismatch",
				shape: "suspected_defect",
				details: { zone, zoneBasis, ...submitted, ...persisted },
			},
		];
	}

	// The legacy validator checked the submitted instants' UTC dates, end date included.
	if (compareInstants(clockOut.instant, clockIn.instant) > 0) {
		const checkedDates = dateSpan(
			clockIn.instant.toZonedDateTimeISO("UTC").toPlainDate(),
			clockOut.instant.toZonedDateTimeISO("UTC").toPlainDate(),
		);
		const occupiedDates = dateSpan(
			clockIn.instant.toZonedDateTimeISO(zone).toPlainDate(),
			clockOut.instant.subtract({ nanoseconds: 1 }).toZonedDateTimeISO(zone).toPlainDate(),
		);
		if (checkedDates.join() !== occupiedDates.join()) {
			drafts.push({
				kind: "manual_holiday_check_dates_differ",
				shape: "suspected_defect",
				details: { zone, checkedDates, occupiedDates },
			});
		}
	}
	return drafts;
}

function parseManualSubmission(metadata: string): ManualSubmissionEvidence | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(metadata);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !isRecord(parsed.request) || !isRecord(parsed.result)) return null;
	if (
		!isRecord(parsed.ordinarySubmission) ||
		parsed.ordinarySubmission.kind !== MANUAL_SUBMISSION_MARKER
	) {
		return null;
	}
	const { request, result } = parsed;
	if (
		typeof request.date !== "string" ||
		typeof request.clockInTime !== "string" ||
		typeof request.clockOutTime !== "string" ||
		!(
			request.timezone === null ||
			request.timezone === undefined ||
			typeof request.timezone === "string"
		) ||
		typeof result.startTime !== "string" ||
		typeof result.endTime !== "string" ||
		typeof result.wasAdjusted !== "boolean"
	) {
		return null;
	}
	try {
		parsePlainDate(request.date);
		parsePlainTimeMinute(request.clockInTime);
		parsePlainTimeMinute(request.clockOutTime);
		parseInstant(result.startTime);
		parseInstant(result.endTime);
	} catch {
		return null;
	}
	return {
		request: {
			date: request.date,
			clockInTime: request.clockInTime,
			clockOutTime: request.clockOutTime,
			timezone: typeof request.timezone === "string" ? request.timezone : null,
		},
		result: {
			startTime: result.startTime,
			endTime: result.endTime,
			wasAdjusted: result.wasAdjusted,
		},
	};
}

type WallTimeInterpretation =
	| { kind: "exact"; instant: Instant }
	| { kind: "nonexistent" }
	| { kind: "repeated" };

function interpretWallTime(date: string, time: string, zone: string): WallTimeInterpretation {
	const wall = parsePlainDate(date).toPlainDateTime(parsePlainTimeMinute(time));
	const candidates = possibleInstants(wall, zone);
	if (candidates.length === 0) return { kind: "nonexistent" };
	if (candidates.length > 1) return { kind: "repeated" };
	return { kind: "exact", instant: candidates[0] };
}

/** Candidate instants for a wall time: none in a gap, two in a fold. */
function possibleInstants(
	wall: ReturnType<ReturnType<typeof parsePlainDate>["toPlainDateTime"]>,
	zone: string,
): Instant[] {
	const earlier = wall.toZonedDateTime(zone, { disambiguation: "earlier" });
	const later = wall.toZonedDateTime(zone, { disambiguation: "later" });
	if (!earlier.toPlainDateTime().equals(wall)) return [];
	return earlier.epochNanoseconds === later.epochNanoseconds
		? [earlier.toInstant()]
		: [earlier.toInstant(), later.toInstant()];
}

function dateSpan(
	first: ReturnType<typeof parsePlainDate>,
	last: ReturnType<typeof parsePlainDate>,
): string[] {
	const dates: string[] = [];
	for (
		let date = first;
		Temporal.PlainDate.compare(date, last) <= 0;
		date = date.add({ days: 1 })
	) {
		dates.push(date.toString());
	}
	return dates;
}

// ---------------------------------------------------------------------------
// Authorized projection
// ---------------------------------------------------------------------------

export interface HistoricalWorkViewerAccess {
	/** Organization administration: record-level access to every employee and org-level work. */
	organizationWide: boolean;
	/** Whether the viewer may read this employee's record-level diagnostics. */
	canDiagnose: (employeeId: string) => boolean;
}

export interface RedactedWorkFinding {
	redacted: true;
	kind: WorkFindingKind;
	shape: WorkFindingShape;
	treatment: WorkFindingTreatment;
	blocking: boolean;
}

export interface ProjectedHistoricalWorkDiagnostics
	extends Omit<HistoricalWorkDiagnostics, "findings" | "completeness"> {
	completeness: HistoricalWorkDiagnostics["completeness"] & { redactedEmployeeCount: number };
	findings: (WorkFinding | RedactedWorkFinding)[];
}

export type HistoricalWorkDiagnosticRead =
	| {
			diagnostics: "record_level";
			report: HistoricalWorkDiagnostics | ProjectedHistoricalWorkDiagnostics;
	  }
	| { diagnostics: "summary"; summary: HistoricalWorkSummary };

/** Status and counts without identities, for readers without diagnostic access. */
export function summarizeHistoricalWork(report: HistoricalWorkDiagnostics) {
	const count = <K extends string>(keyOf: (finding: WorkFinding) => K) => {
		const counts: Partial<Record<K, number>> = {};
		for (const finding of report.findings) {
			const key = keyOf(finding);
			counts[key] = (counts[key] ?? 0) + 1;
		}
		return counts;
	};
	return {
		status: report.completeness.status,
		widenedTo: report.completeness.widenedTo,
		range: report.scope.range,
		findingCount: report.findings.length,
		blockingFindingCount: report.completeness.blockingFindingIds.length,
		affectedEmployeeCount: report.completeness.affectedEmployeeIds.length,
		byShape: count((finding) => finding.shape),
		byTreatment: count((finding) => finding.treatment),
	};
}

export type HistoricalWorkSummary = ReturnType<typeof summarizeHistoricalWork>;

/**
 * Record-level findings go to operators; a finding naming an employee they may not
 * diagnose, or organization-level work they may not see, keeps only its
 * classification. Readers without any diagnostic access receive the summary.
 */
export function projectHistoricalWorkForViewer(
	report: HistoricalWorkDiagnostics,
	access: HistoricalWorkViewerAccess,
): HistoricalWorkDiagnosticRead {
	if (access.organizationWide) return { diagnostics: "record_level", report };
	const visible = (finding: WorkFinding) =>
		finding.relevance.level !== "organization" &&
		finding.employeeIds.length > 0 &&
		finding.employeeIds.every((employeeId) => access.canDiagnose(employeeId));
	if (!report.scope.employeeIds.some((employeeId) => access.canDiagnose(employeeId))) {
		return { diagnostics: "summary", summary: summarizeHistoricalWork(report) };
	}
	const findings = report.findings.map((finding): WorkFinding | RedactedWorkFinding =>
		visible(finding)
			? finding
			: {
					redacted: true,
					kind: finding.kind,
					shape: finding.shape,
					treatment: finding.treatment,
					blocking: finding.blocking,
				},
	);
	const visibleIds = new Set(report.findings.filter(visible).map((finding) => finding.id));
	const affected = report.completeness.affectedEmployeeIds;
	return {
		diagnostics: "record_level",
		report: {
			...report,
			scope: {
				...report.scope,
				employeeIds: report.scope.employeeIds.filter((employeeId) =>
					access.canDiagnose(employeeId),
				),
			},
			completeness: {
				...report.completeness,
				affectedEmployeeIds: affected.filter((employeeId) => access.canDiagnose(employeeId)),
				redactedEmployeeCount: affected.filter((employeeId) => !access.canDiagnose(employeeId))
					.length,
				blockingFindingIds: report.completeness.blockingFindingIds.filter((id) =>
					visibleIds.has(id),
				),
			},
			findings,
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const value of values) {
		const key = keyOf(value);
		const group = groups.get(key);
		if (group) group.push(value);
		else groups.set(key, [value]);
	}
	return groups;
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].toSorted(compareStrings);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function nonNull(value: string | null): string[] {
	return value === null ? [] : [value];
}

function isString(value: string | undefined): value is string {
	return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
