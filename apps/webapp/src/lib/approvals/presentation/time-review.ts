import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalChainStageInstance,
	approvalSubmittedRevision,
	approvalWorkflowStage,
} from "@/db/schema";
import { instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import { formatUtcOffset, offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { isWorkLocationType } from "@/lib/time-tracking/work-location";
import {
	type DecisionEvidenceRecord,
	type LegacyDecisionEvidenceRecord,
	listDecisionEvidence,
	listLegacyDecisionEvidence,
	loadCanonicalTimeCorrectionSubmittedRevision,
	loadCanonicalWorkPeriodSubmittedRevision,
	loadLegacyTimeCorrectionSubmittedRevision,
	loadLegacyWorkPeriodSubmittedRevision,
	readApprovalEvidenceMode,
	type TimeCorrectionSubmittedRevisionRecord,
	type WorkPeriodSubmittedRevisionRecord,
} from "../evidence/store";
import { compareTimeCorrectionWithSubmittedRevision } from "../evidence/time-correction-evidence";
import type { TimeCorrectionRevisionComparison } from "../evidence/time-correction-facts";
import { compareWorkPeriodWithSubmittedRevision } from "../evidence/work-period-evidence";
import type {
	WorkPeriodEndpointFacts,
	WorkPeriodRevisionComparison,
} from "../evidence/work-period-facts";
import type { ApprovalInboxDetailSection } from "../inbox/types";
import type { WorkCategoryReviewValue } from "../server/time-correction-review-metadata";
import type { ApprovalDatabase } from "../server/types";
import { isTimeApprovalWorkflowType, type TimeApprovalWorkflowType } from "../time-approval-kinds";
import { loadTimeCorrectionCategoryNames } from "./time-card";

type TimeDecisionEvidence = DecisionEvidenceRecord | LegacyDecisionEvidenceRecord;

export type TimeReviewEvidence =
	| {
			/** No submitted revision exists. While capture is active this is a hold. */
			status: "not_captured";
			held: boolean;
	  }
	| {
			status: "evidenced";
			kind: "work_period";
			revision: WorkPeriodSubmittedRevisionRecord;
			/** Null once the request is no longer pending: results then describe it. */
			comparison: WorkPeriodRevisionComparison | null;
			decisions: TimeDecisionEvidence[];
	  }
	| {
			status: "evidenced";
			kind: "time_correction";
			revision: TimeCorrectionSubmittedRevisionRecord;
			comparison: TimeCorrectionRevisionComparison | null;
			decisions: TimeDecisionEvidence[];
			/** Current names of the categories the proposal names; null = unavailable. */
			categoryNames: Readonly<Record<string, string | null>>;
	  };

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const UNAVAILABLE = { key: "approvals:approvals.evidence.unavailable", fallback: "Unavailable" };

function text(key: string, fallback: string) {
	return { key: `approvals:approvals.evidence.${key}`, fallback };
}

/**
 * The local wall time of the event in its own captured offset, with that
 * offset. It never shifts with the viewer, and the same text is shown to
 * every reviewer.
 */
export function capturedEndpointText(
	endpoint: Pick<WorkPeriodEndpointFacts, "at" | "utcOffsetMinutes">,
): string {
	const local = parseInstant(endpoint.at).toZonedDateTimeISO(
		offsetMinutesToTimeZoneId(endpoint.utcOffsetMinutes),
	);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${local.toPlainDate().toString()} ${pad(local.hour)}:${pad(local.minute)} (${formatUtcOffset(endpoint.utcOffsetMinutes)})`;
}

function minutesText(minutes: number): string {
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function elapsedText(seconds: number): string {
	const whole = Math.floor(seconds);
	const base = `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`;
	return whole % 60 === 0 ? base : `${base} ${whole % 60} s`;
}

function roleRows(
	revision: WorkPeriodSubmittedRevisionRecord | TimeCorrectionSubmittedRevisionRecord,
): Row[] {
	const rows: Row[] = [
		{
			label: { key: "approvals:approvals.employee", fallback: "Employee" },
			value: revision.labels.subjectName ?? UNAVAILABLE,
		},
	];
	if (revision.requesterEmployeeId !== revision.subjectEmployeeId) {
		rows.push({
			label: text("requestedBy", "Requested by"),
			value: revision.labels.requesterName ?? UNAVAILABLE,
		});
	}
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		rows.push({
			label: text("submittedBy", "Submitted by"),
			value: revision.labels.submitterName ?? UNAVAILABLE,
		});
	}
	return rows;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isEndpoint(value: unknown): value is WorkPeriodEndpointFacts {
	const endpoint = record(value);
	return (
		typeof endpoint?.at === "string" &&
		typeof endpoint.utcOffsetMinutes === "number" &&
		Number.isSafeInteger(endpoint.utcOffsetMinutes)
	);
}

function segmentText(segment: Record<string, unknown>): string | null {
	if (!isEndpoint(segment.clockIn)) return null;
	const end = isEndpoint(segment.clockOut) ? capturedEndpointText(segment.clockOut) : null;
	const minutes =
		typeof segment.storedDurationMinutes === "number"
			? ` · ${minutesText(segment.storedDurationMinutes)}`
			: "";
	return `${capturedEndpointText(segment.clockIn)} – ${end ?? "…"}${minutes}`;
}

function outcomeValue(status: unknown) {
	return status === "approved"
		? text("outcomeApproved", "Approved")
		: status === "rejected"
			? text("outcomeRejected", "Rejected")
			: UNAVAILABLE;
}

/** The committed result graph of a work-period decision, as recorded. */
function workPeriodResultRows(terminal: Record<string, unknown>): Row[] {
	const rows: Row[] = [{ label: text("outcome", "Outcome"), value: outcomeValue(terminal.status) }];
	const adjustment = record(terminal.adjustment);
	if (adjustment?.kind === "break_enforced" && typeof adjustment.breakMinutes === "number") {
		rows.push({
			label: text("breakInserted", "Break inserted"),
			value: `${adjustment.breakMinutes} min`,
		});
	} else if (adjustment?.kind === "break_not_required") {
		rows.push({
			label: text("breakAdjustment", "Break adjustment"),
			value: text("breakNotRequired", "No break was required"),
		});
	}
	const segments = Array.isArray(terminal.segments) ? terminal.segments : [];
	segments.forEach((value, index) => {
		const segment = record(value);
		rows.push({
			label: `Segment ${index + 1}`,
			value: (segment && segmentText(segment)) ?? UNAVAILABLE,
		});
	});
	return rows;
}

function decisionLabel(decision: TimeDecisionEvidence): string {
	if (decision.operationKind === "submission_activation") {
		return "Approved automatically during submission";
	}
	if (decision.requestOutcome === "approved") return "Request approved";
	if (decision.requestOutcome === "rejected") return "Request rejected";
	if (decision.assignmentOutcome === "approved") {
		return "Approval recorded — awaiting further approval";
	}
	if (decision.assignmentOutcome === "rejected") return "Rejection recorded";
	return "Decision recorded";
}

/**
 * Renders a time approval's immutable evidence into authenticated review
 * sections (#325): the submitted facts, each committed result separately, and
 * the evidence history with persisted times and actors. A material change or
 * a missing revision while capture is active blocks decisions, as the server
 * does. Reason text is never part of the evidence and is not shown here.
 */
export function buildTimeReviewSections(evidence: TimeReviewEvidence): {
	sections: ApprovalInboxDetailSection[];
	decisionsBlocked: boolean;
} {
	if (evidence.status === "not_captured") {
		return evidence.held
			? {
					sections: [
						{
							type: "callout",
							title: "Submitted times unavailable",
							body: "The times submitted for this request were not recorded, so a decision cannot be bound to them. The request is held for review.",
							tone: "warning",
						},
					],
					decisionsBlocked: true,
				}
			: { sections: [], decisionsBlocked: false };
	}
	const sections: ApprovalInboxDetailSection[] = [];
	if (evidence.kind === "work_period") {
		const { facts } = evidence.revision;
		const rows: Row[] = [
			...roleRows(evidence.revision),
			{ label: text("clockIn", "Clock in"), value: capturedEndpointText(facts.interval.clockIn) },
			{
				label: text("clockOut", "Clock out"),
				value: capturedEndpointText(facts.interval.clockOut),
			},
			{
				label: text("submittedDuration", "Submitted duration"),
				value: minutesText(facts.interval.storedDurationMinutes),
			},
			{
				label: text("elapsedTime", "Elapsed time"),
				value: elapsedText(facts.interval.elapsedSeconds),
			},
		];
		if (facts.policy.kind === "policy_clock_out" && facts.policy.breakAdjustment === "may_apply") {
			rows.push({
				label: text("breakAdjustment", "Break adjustment"),
				value: text(
					"breakAdjustmentMayApply",
					"May apply when approved; the result is recorded separately",
				),
			});
		}
		sections.push({
			type: "key_value",
			title: text("submittedTimesTitle", "Submitted times"),
			rows,
		});
	}
	if (evidence.kind === "time_correction") {
		sections.push({
			type: "key_value",
			title: text("requestedCorrectionTitle", "Requested correction"),
			rows: correctionRequestRows(evidence.revision, evidence.categoryNames),
		});
	}
	for (const decision of evidence.decisions) {
		const terminal = record(record(decision.result)?.terminal);
		if (!terminal) continue;
		sections.push({
			type: "key_value",
			title: text("resultTitle", "Result"),
			rows:
				evidence.kind === "work_period"
					? workPeriodResultRows(terminal)
					: correctionResultRows(terminal),
		});
	}
	const changed = evidence.comparison?.kind === "material_change";
	if (changed) {
		sections.unshift({
			type: "callout",
			title: "Entry changed after submission",
			body: "The entry no longer matches what was submitted for approval. A decision cannot be recorded; the request needs review.",
			tone: "danger",
		});
	}
	sections.push({
		type: "timeline",
		title: "Evidence history",
		events: [
			{
				id: `evidence-submitted-${evidence.revision.id}`,
				label: "Submitted",
				at: instantToCanonicalString(evidence.revision.submittedAt),
				actorName: evidence.revision.labels.submitterName,
			},
			...evidence.decisions.map((decision) => ({
				id: `evidence-decision-${decision.id}`,
				label: decisionLabel(decision),
				// Persisted decision time; never the render or retry time.
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		],
	});
	return { sections, decisionsBlocked: changed };
}

const CORRECTION_REQUESTS = {
	edit: text("correctionEdit", "Change times"),
	metadata_only: text("correctionMetadata", "Change work details"),
	delete: text("correctionDelete", "Delete this entry"),
} as const;

function categoryValue(
	id: string | null,
	names: Readonly<Record<string, string | null>>,
): WorkCategoryReviewValue {
	if (id === null) return { state: "none" };
	const name = names[id];
	// Only current names exist; an unknown one stays explicitly unavailable.
	return name ? { state: "named", id, name } : { state: "unavailable", id };
}

function correctionRequestRows(
	revision: TimeCorrectionSubmittedRevisionRecord,
	categoryNames: Readonly<Record<string, string | null>>,
): Row[] {
	const { baseline, requested, changeMask, intent } = revision.facts;
	const rows: Row[] = [
		...roleRows(revision),
		{ label: text("request", "Request"), value: CORRECTION_REQUESTS[intent] },
		{
			label: text("entry", "Entry"),
			value: `${capturedEndpointText(baseline.clockIn)} – ${baseline.clockOut ? capturedEndpointText(baseline.clockOut) : "…"}`,
		},
	];
	if (baseline.storedDurationMinutes !== null) {
		rows.push({
			label: text("durationBefore", "Duration before"),
			value: minutesText(baseline.storedDurationMinutes),
		});
	}
	// Deletion markers are never shown as proposed working times.
	if (intent === "delete") return rows;
	if (changeMask.clockIn && requested.clockIn) {
		rows.push({
			label: text("clockIn", "Clock in"),
			value: `${capturedEndpointText(baseline.clockIn)} → ${capturedEndpointText(requested.clockIn)}`,
		});
	}
	if (changeMask.clockOut && requested.clockOut) {
		rows.push({
			label: text("clockOut", "Clock out"),
			value: `${baseline.clockOut ? capturedEndpointText(baseline.clockOut) : "…"} → ${capturedEndpointText(requested.clockOut)}`,
		});
	}
	if (changeMask.workLocation && requested.workLocationType.kind === "set") {
		const before = baseline.attribution.workLocationType;
		const after = requested.workLocationType.value;
		rows.push({
			label: { key: "approvals:approvals.workLocation", fallback: "Work location" },
			value:
				isWorkLocationType(before) && isWorkLocationType(after)
					? {
							kind: "change",
							original: { kind: "work_location", value: before },
							requested: { kind: "work_location", value: after },
						}
					: `${before ?? "…"} → ${after ?? "…"}`,
		});
	}
	if (changeMask.workCategory && requested.workCategoryId.kind === "set") {
		rows.push({
			label: { key: "approvals:approvals.workCategory", fallback: "Work category" },
			value: {
				kind: "change",
				original: {
					kind: "work_category",
					value: categoryValue(baseline.attribution.workCategoryId, categoryNames),
				},
				requested: {
					kind: "work_category",
					value: categoryValue(requested.workCategoryId.value, categoryNames),
				},
			},
		});
	}
	return rows;
}

/** The committed graph a correction's finalization left, as recorded. */
function correctionResultRows(terminal: Record<string, unknown>): Row[] {
	const rows: Row[] = [
		{ label: text("outcome", "Outcome"), value: outcomeValue(terminal.transition) },
	];
	if (terminal.kind === "deleted") {
		rows.push({ label: text("entry", "Entry"), value: text("entryDeleted", "Deleted") });
		return rows;
	}
	const segment = record(terminal.segment);
	const clockIn = segment?.clockIn;
	const clockOut = segment?.clockOut;
	rows.push({
		label: text("entry", "Entry"),
		value: isEndpoint(clockIn)
			? `${capturedEndpointText(clockIn)} – ${isEndpoint(clockOut) ? capturedEndpointText(clockOut) : "…"}`
			: UNAVAILABLE,
	});
	// The resulting stored minutes, apart from the submitted baseline's.
	if (typeof segment?.storedDurationMinutes === "number") {
		rows.push({
			label: text("resultingDuration", "Resulting duration"),
			value: minutesText(segment.storedDurationMinutes),
		});
	}
	return rows;
}

/**
 * The lifecycle a time request belongs to and the kind of its revision: its
 * canonical workflow when a stage mirrors this request and the revision was
 * captured under canonical authority, otherwise the legacy request or chain.
 * A shared work-period ID alone never links two cycles.
 */
async function findTimeRevisionLifecycle(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalRequestId: string; workPeriodId: string },
): Promise<
	| { authority: "canonical"; workflowId: string; kind: TimeApprovalWorkflowType }
	| {
			authority: "legacy";
			chainInstanceId: string | null;
			kind: TimeApprovalWorkflowType;
	  }
	| null
> {
	const [stages, chainStages] = await Promise.all([
		database
			.select({ workflowId: approvalWorkflowStage.workflowId })
			.from(approvalWorkflowStage)
			.where(
				and(
					eq(approvalWorkflowStage.organizationId, input.organizationId),
					eq(approvalWorkflowStage.legacyApprovalRequestId, input.approvalRequestId),
				),
			)
			.limit(2),
		database
			.select({ chainInstanceId: approvalChainStageInstance.chainInstanceId })
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
				),
			)
			.limit(2),
	]);
	const workflowId = stages.length === 1 ? (stages[0]?.workflowId ?? null) : null;
	const chainInstanceId =
		chainStages.length === 1 ? (chainStages[0]?.chainInstanceId ?? null) : null;
	const legacyLifecycle = chainInstanceId
		? or(
				eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId),
				eq(approvalSubmittedRevision.legacyChainInstanceId, chainInstanceId),
			)
		: eq(approvalSubmittedRevision.legacyApprovalRequestId, input.approvalRequestId);
	const rows = await database
		.select({
			authority: approvalSubmittedRevision.authority,
			workflowType: approvalSubmittedRevision.workflowType,
		})
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.sourceType, "time_entry"),
				eq(approvalSubmittedRevision.sourceId, input.workPeriodId),
				workflowId
					? or(
							and(
								eq(approvalSubmittedRevision.authority, "canonical"),
								eq(approvalSubmittedRevision.workflowId, workflowId),
							),
							and(eq(approvalSubmittedRevision.authority, "legacy"), legacyLifecycle),
						)
					: and(eq(approvalSubmittedRevision.authority, "legacy"), legacyLifecycle),
			),
		)
		.limit(2);
	// The authority that owns the request wins; a legacy capture of a request
	// a canonical stage now mirrors is only an earlier observation of it.
	const canonical = rows.filter((row) => row.authority === "canonical");
	const chosen = canonical.length > 0 ? canonical : rows;
	const row = chosen[0];
	if (chosen.length !== 1 || !row || !isTimeApprovalWorkflowType(row.workflowType)) return null;
	return row.authority === "canonical" && workflowId
		? { authority: "canonical", workflowId, kind: row.workflowType }
		: { authority: "legacy", chainInstanceId, kind: row.workflowType };
}

/**
 * Scoped review preparation for a time approval request (#325): its submitted
 * revision under whichever authority captured it, whether the live work graph
 * still matches it while the request is pending, and each committed
 * decision's original evidence with its result. Infrastructure errors throw.
 */
export async function prepareTimeReviewEvidence(
	input: {
		organizationId: string;
		approvalRequestId: string;
		workPeriodId: string;
		requestPending: boolean;
		/** The request's kind as classified by the inbox, for the capture hold. */
		kind: TimeApprovalWorkflowType | null;
	},
	database: ApprovalDatabase = db,
): Promise<TimeReviewEvidence> {
	const lifecycle = await findTimeRevisionLifecycle(database, input);
	if (!lifecycle) {
		const mode = input.kind
			? await readApprovalEvidenceMode(database, {
					organizationId: input.organizationId,
					workflowType: input.kind,
				})
			: "inactive";
		return { status: "not_captured", held: input.requestPending && mode === "capture" };
	}
	const legacyScope = {
		organizationId: input.organizationId,
		workPeriodId: input.workPeriodId,
		approvalRequestId: input.approvalRequestId,
		chainInstanceId: lifecycle.authority === "legacy" ? lifecycle.chainInstanceId : null,
	};
	const decisionsFor = (revisionId: string) =>
		lifecycle.authority === "canonical"
			? listDecisionEvidence(database, {
					organizationId: input.organizationId,
					workflowId: lifecycle.workflowId,
				})
			: listLegacyDecisionEvidence(database, {
					organizationId: input.organizationId,
					submittedRevisionId: revisionId,
				});
	if (lifecycle.kind === "time_correction") {
		const revision =
			lifecycle.authority === "canonical"
				? await loadCanonicalTimeCorrectionSubmittedRevision(database, {
						organizationId: input.organizationId,
						workflowId: lifecycle.workflowId,
					})
				: await loadLegacyTimeCorrectionSubmittedRevision(database, legacyScope);
		if (!revision) return { status: "not_captured", held: false };
		const [comparison, decisions, categoryNames] = await Promise.all([
			input.requestPending ? compareTimeCorrectionWithSubmittedRevision(database, revision) : null,
			decisionsFor(revision.id),
			loadTimeCorrectionCategoryNames(database, input.organizationId, revision),
		]);
		return {
			status: "evidenced",
			kind: "time_correction",
			revision,
			comparison,
			decisions,
			categoryNames,
		};
	}
	const revision =
		lifecycle.authority === "canonical"
			? await loadCanonicalWorkPeriodSubmittedRevision(database, {
					organizationId: input.organizationId,
					workflowId: lifecycle.workflowId,
				})
			: await loadLegacyWorkPeriodSubmittedRevision(database, legacyScope);
	if (!revision) return { status: "not_captured", held: false };
	const [comparison, decisions] = await Promise.all([
		input.requestPending ? compareWorkPeriodWithSubmittedRevision(database, revision) : null,
		decisionsFor(revision.id),
	]);
	return { status: "evidenced", kind: "work_period", revision, comparison, decisions };
}
