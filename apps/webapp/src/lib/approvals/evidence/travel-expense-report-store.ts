import { and, desc, eq } from "drizzle-orm";
import { approvalSubmittedRevision } from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { ApprovalDatabase } from "../server/types";
import { ApprovalEvidenceError } from "./errors";
import {
	insertTravelExpenseReportSubmittedRevision,
	type LegacyLifecycleReference,
	type SubmitterIdentity,
} from "./store";
import {
	fingerprintTravelExpenseReportFacts,
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseReportSubmittedFacts,
	type TravelExpenseReportSubmittedLabels,
} from "./travel-expense-report-facts";

/**
 * Submitted revisions of travel expense reports (#602). Reports are decided by
 * legacy authority like expense claims, so each submission cycle is one legacy
 * revision linked to the approval request routing created for it. Unlike a
 * claim, a report is always frozen: reviewers only ever see these facts.
 */

export const TRAVEL_EXPENSE_REPORT_SOURCE_TYPE = "travel_expense_report";

export function travelExpenseReportRequestCycleKey(reportId: string, cycle: number): string {
	return `${TRAVEL_EXPENSE_REPORT_SOURCE_TYPE}:${reportId}:submission:${cycle}`;
}

export interface TravelExpenseReportSubmittedRevisionRecord {
	id: string;
	authority: "legacy";
	organizationId: string;
	reportId: string;
	submissionCycle: number;
	requestCycleKey: string;
	revision: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitter: SubmitterIdentity;
	materialFingerprint: string;
	facts: TravelExpenseReportSubmittedFacts;
	labels: TravelExpenseReportSubmittedLabels;
	submittedAt: Instant;
	legacy: LegacyLifecycleReference;
}

type SubmittedRevisionRow = typeof approvalSubmittedRevision.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
	return value === null || typeof value === "string";
}

/**
 * Every version up to the current one stays readable: a revision keeps the
 * version (and fingerprint prefix) it was frozen with, and later versions
 * only add optional facts, so older revisions parse unchanged.
 */
function isReadableSchemaVersion(version: unknown): version is number {
	return (
		typeof version === "number" &&
		Number.isInteger(version) &&
		version >= 1 &&
		version <= TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION
	);
}

function parseRevision(
	row: SubmittedRevisionRow,
	scope: { organizationId: string; reportId: string },
): TravelExpenseReportSubmittedRevisionRecord {
	const { facts, labels } = row;
	if (
		row.organizationId !== scope.organizationId ||
		row.authority !== "legacy" ||
		row.workflowId !== null ||
		!row.legacyApprovalRequestId ||
		row.workflowType !== "travel_expense" ||
		row.sourceType !== TRAVEL_EXPENSE_REPORT_SOURCE_TYPE ||
		row.sourceId !== scope.reportId ||
		!isReadableSchemaVersion(row.schemaVersion) ||
		row.provenance !== "captured_at_submission" ||
		row.submitterActorKind !== "employee" ||
		!isRecord(facts) ||
		facts.kind !== "travel_expense_report" ||
		facts.schemaVersion !== row.schemaVersion ||
		facts.organizationId !== row.organizationId ||
		facts.reportId !== row.sourceId ||
		typeof facts.submissionCycle !== "number" ||
		row.requestCycleKey !==
			travelExpenseReportRequestCycleKey(row.sourceId, facts.submissionCycle) ||
		facts.subjectEmployeeId !== row.subjectEmployeeId ||
		facts.requesterEmployeeId !== row.requesterEmployeeId ||
		!Array.isArray(facts.items) ||
		!isRecord(facts.totals) ||
		!isRecord(labels) ||
		!nullableString(labels.subjectName) ||
		!nullableString(labels.submitterName) ||
		!isRecord(labels.receiptFileNames)
	) {
		throw new ApprovalEvidenceError("invariant", { field: "report_submitted_revision" });
	}
	const parsedFacts = facts as unknown as TravelExpenseReportSubmittedFacts;
	if (fingerprintTravelExpenseReportFacts(parsedFacts) !== row.materialFingerprint) {
		throw new ApprovalEvidenceError("invariant", { field: "material_fingerprint" });
	}
	return {
		id: row.id,
		authority: "legacy",
		organizationId: row.organizationId,
		reportId: row.sourceId,
		submissionCycle: parsedFacts.submissionCycle,
		requestCycleKey: row.requestCycleKey,
		revision: row.revision,
		subjectEmployeeId: row.subjectEmployeeId,
		requesterEmployeeId: row.requesterEmployeeId,
		submitter: {
			kind: row.submitterActorKind,
			employeeId: row.submitterEmployeeId,
			userId: row.submitterUserId,
		},
		materialFingerprint: row.materialFingerprint,
		facts: parsedFacts,
		labels: labels as unknown as TravelExpenseReportSubmittedLabels,
		submittedAt: instantFromDate(row.submittedAt),
		legacy: {
			approvalRequestId: row.legacyApprovalRequestId,
			chainInstanceId: row.legacyChainInstanceId,
			observedWorkflowId: row.observedWorkflowId,
		},
	};
}

/**
 * One submission cycle's frozen revision, or the latest when no cycle is
 * named. Always scoped to the organization; another tenant sees nothing.
 */
export async function loadTravelExpenseReportSubmittedRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; submissionCycle?: number },
): Promise<TravelExpenseReportSubmittedRevisionRecord | null> {
	const rows = await database
		.select()
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, input.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
				eq(approvalSubmittedRevision.sourceType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				eq(approvalSubmittedRevision.sourceId, input.reportId),
				...(input.submissionCycle === undefined
					? []
					: [
							eq(
								approvalSubmittedRevision.requestCycleKey,
								travelExpenseReportRequestCycleKey(input.reportId, input.submissionCycle),
							),
						]),
			),
		)
		.orderBy(desc(approvalSubmittedRevision.submittedAt), desc(approvalSubmittedRevision.createdAt))
		.limit(1);
	const row = rows[0];
	return row ? parseRevision(row, input) : null;
}

/**
 * Written by the report submission owner inside the transaction that submits
 * the report and creates its legacy approval rows. A failure rolls back the
 * whole submission; a second capture of the same cycle is an invariant breach.
 */
export async function captureTravelExpenseReportSubmittedRevision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		submittedAt: Instant;
		facts: TravelExpenseReportSubmittedFacts;
		labels: TravelExpenseReportSubmittedLabels;
		submitter: { employeeId: string; userId: string };
		legacy: LegacyLifecycleReference;
	},
): Promise<TravelExpenseReportSubmittedRevisionRecord> {
	const { facts } = input;
	if (facts.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	// The immutable evidence owner writes the row; this store only parses it.
	const row = await insertTravelExpenseReportSubmittedRevision(database, {
		...input,
		requestCycleKey: travelExpenseReportRequestCycleKey(facts.reportId, facts.submissionCycle),
		materialFingerprint: fingerprintTravelExpenseReportFacts(facts),
	});
	return parseRevision(row, { organizationId: input.organizationId, reportId: facts.reportId });
}
