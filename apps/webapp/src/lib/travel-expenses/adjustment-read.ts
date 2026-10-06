import { and, eq, inArray, max } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	approvalDecisionEvidence,
	travelExpenseReport,
	travelExpenseReportAdjustment,
} from "@/db/schema";
import type { TravelExpenseReportAdjustmentLink } from "@/lib/approvals/evidence/travel-expense-report-adjustment";
import {
	loadTravelExpenseReportSubmittedRevision,
	loadTravelExpenseReportSubmittedRevisions,
} from "@/lib/approvals/evidence/travel-expense-report-store";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { type AdjustmentBaseline, composeAdjustmentBaseline } from "./adjustment";

/**
 * Reads of report adjustments (#615) that the settlement, the frozen facts
 * loader and the adjustment store share. Nothing here imports the settlement
 * store, so it can depend on these reads.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AdjustmentExecutor = Database | Transaction;

/** The original report and reason of an adjustment report; null for any other report. */
export async function loadAdjustmentLink(
	database: AdjustmentExecutor,
	scope: { organizationId: string; reportId: string },
): Promise<TravelExpenseReportAdjustmentLink | null> {
	const [row] = await database
		.select({
			originalReportId: travelExpenseReportAdjustment.originalReportId,
			reason: travelExpenseReportAdjustment.reason,
		})
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, scope.organizationId),
				eq(travelExpenseReportAdjustment.reportId, scope.reportId),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * The other reports of a report's adjustment family (#615): its original and
 * every adjustment of that original. They describe the same expenses, so
 * checks for expenses claimed twice (e.g. per diem days) must not count them
 * against each other; only the approved deltas are ever settled.
 */
export async function loadAdjustmentFamilyIds(
	database: AdjustmentExecutor,
	scope: { organizationId: string; reportId: string },
): Promise<string[]> {
	const link = await loadAdjustmentLink(database, scope);
	const originalReportId = link?.originalReportId ?? scope.reportId;
	const rows = await database
		.select({ reportId: travelExpenseReportAdjustment.reportId })
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, scope.organizationId),
				eq(travelExpenseReportAdjustment.originalReportId, originalReportId),
			),
		);
	return [originalReportId, ...rows.map((row) => row.reportId)].filter(
		(id) => id !== scope.reportId,
	);
}

/** Which of these reports are adjustment reports, mapped to the report each corrects. */
export async function loadAdjustmentOriginals(
	database: AdjustmentExecutor,
	input: { organizationId: string; reportIds: readonly string[] },
): Promise<Map<string, string>> {
	const originals = new Map<string, string>();
	if (input.reportIds.length === 0) return originals;
	const rows = await database
		.select({
			reportId: travelExpenseReportAdjustment.reportId,
			originalReportId: travelExpenseReportAdjustment.originalReportId,
		})
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, input.organizationId),
				inArray(travelExpenseReportAdjustment.reportId, [...input.reportIds]),
			),
		);
	for (const row of rows) originals.set(row.reportId, row.originalReportId);
	return originals;
}

export interface ApprovedAdjustment {
	/** The adjustment report. */
	reportId: string;
	/** Its approved frozen revision. */
	revisionId: string;
	submissionCycle: number;
	/** The frozen signed delta. */
	delta: string;
	currency: string;
	reason: string;
	approvedAt: Instant;
}

/**
 * Approved adjustments of the given original reports, by original report id.
 * Approved means what it means for any report (#612): the adjustment report is
 * approved now, its current cycle is frozen and decision evidence records the
 * approval of that revision. Each contributes its frozen delta once; a
 * pending, returned, withdrawn or rejected adjustment contributes nothing.
 */
export async function loadApprovedAdjustments(
	database: AdjustmentExecutor,
	input: { organizationId: string; originalReportIds: readonly string[] },
): Promise<Map<string, ApprovedAdjustment[]>> {
	const approved = new Map<string, ApprovedAdjustment[]>();
	if (input.originalReportIds.length === 0) return approved;
	const links = await database
		.select({
			reportId: travelExpenseReportAdjustment.reportId,
			originalReportId: travelExpenseReportAdjustment.originalReportId,
			submissionCount: travelExpenseReport.submissionCount,
		})
		.from(travelExpenseReportAdjustment)
		.innerJoin(
			travelExpenseReport,
			and(
				eq(travelExpenseReport.id, travelExpenseReportAdjustment.reportId),
				eq(travelExpenseReport.organizationId, travelExpenseReportAdjustment.organizationId),
			),
		)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, input.organizationId),
				inArray(travelExpenseReportAdjustment.originalReportId, [...input.originalReportIds]),
				eq(travelExpenseReport.status, "approved"),
			),
		);
	if (links.length === 0) return approved;
	const revisions = await loadTravelExpenseReportSubmittedRevisions(database, {
		organizationId: input.organizationId,
		cycles: links.map((link) => ({
			reportId: link.reportId,
			submissionCycle: link.submissionCount,
		})),
	});
	const revisionIds = [...revisions.values()].map((revision) => revision.id);
	const decisions =
		revisionIds.length === 0
			? []
			: await database
					.select({
						revisionId: approvalDecisionEvidence.submittedRevisionId,
						decidedAt: max(approvalDecisionEvidence.decidedAt),
					})
					.from(approvalDecisionEvidence)
					.where(
						and(
							eq(approvalDecisionEvidence.organizationId, input.organizationId),
							eq(approvalDecisionEvidence.authority, "legacy"),
							inArray(approvalDecisionEvidence.submittedRevisionId, revisionIds),
							eq(approvalDecisionEvidence.requestOutcome, "approved"),
						),
					)
					.groupBy(approvalDecisionEvidence.submittedRevisionId);
	const decidedAt = new Map(
		decisions.flatMap((row) => (row.decidedAt ? [[row.revisionId, row.decidedAt]] : [])),
	);
	for (const link of links) {
		const revision = revisions.get(link.reportId);
		const adjustment = revision?.facts.adjustment;
		const at = revision ? decidedAt.get(revision.id) : undefined;
		// Only a frozen delta for exactly this original counts.
		if (!revision || !adjustment || !at || adjustment.originalReportId !== link.originalReportId) {
			continue;
		}
		const list = approved.get(link.originalReportId) ?? [];
		list.push({
			reportId: link.reportId,
			revisionId: revision.id,
			submissionCycle: revision.submissionCycle,
			delta: adjustment.delta.amount,
			currency: adjustment.delta.currency,
			reason: adjustment.reason,
			approvedAt: instantFromDate(at),
		});
		approved.set(link.originalReportId, list);
	}
	return approved;
}

async function isRevisionApproved(
	database: AdjustmentExecutor,
	organizationId: string,
	revisionId: string,
): Promise<boolean> {
	const [row] = await database
		.select({ id: approvalDecisionEvidence.id })
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, organizationId),
				eq(approvalDecisionEvidence.authority, "legacy"),
				eq(approvalDecisionEvidence.submittedRevisionId, revisionId),
				eq(approvalDecisionEvidence.requestOutcome, "approved"),
			),
		)
		.limit(1);
	return Boolean(row);
}

export type AdjustmentBaselineResult =
	| { status: "ok"; baseline: AdjustmentBaseline; approved: ApprovedAdjustment[] }
	| { status: "not_found" }
	| { status: "not_approved" };

/**
 * The effective approved entitlement of an original report now: its approved
 * frozen revision plus every approved adjustment. With `lock`, the original
 * report row is locked first (the settlement account lock, `settlement-store`),
 * so the baseline cannot change until the caller's transaction ends.
 */
export async function loadAdjustmentBaseline(
	database: AdjustmentExecutor,
	input: { organizationId: string; originalReportId: string },
	options: { lock?: boolean } = {},
): Promise<AdjustmentBaselineResult> {
	const query = database
		.select({
			status: travelExpenseReport.status,
			submissionCount: travelExpenseReport.submissionCount,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.originalReportId),
				eq(travelExpenseReport.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const [original] = options.lock ? await query.for("update") : await query;
	if (!original) return { status: "not_found" };
	if (original.status !== "approved") return { status: "not_approved" };
	const revision = await loadTravelExpenseReportSubmittedRevision(database, {
		organizationId: input.organizationId,
		reportId: input.originalReportId,
		submissionCycle: original.submissionCount,
	});
	if (!revision || !(await isRevisionApproved(database, input.organizationId, revision.id))) {
		return { status: "not_approved" };
	}
	const approved =
		(
			await loadApprovedAdjustments(database, {
				organizationId: input.organizationId,
				originalReportIds: [input.originalReportId],
			})
		).get(input.originalReportId) ?? [];
	const currency = revision.facts.totals.currency;
	if (approved.some((adjustment) => adjustment.currency !== currency)) {
		throw new Error("Approved adjustments disagree with their original report's currency");
	}
	return {
		status: "ok",
		approved,
		baseline: composeAdjustmentBaseline(
			{
				originalReportId: input.originalReportId,
				revisionId: revision.id,
				submissionCycle: revision.submissionCycle,
				currency,
				approvedAmount: revision.facts.totals.reimbursable,
			},
			approved.map(({ reportId, revisionId, delta }) => ({ reportId, revisionId, delta })),
		),
	};
}
