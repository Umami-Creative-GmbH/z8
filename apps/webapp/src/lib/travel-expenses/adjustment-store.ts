import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReportStatus,
	travelExpenseReport,
	travelExpenseReportAdjustment,
	travelExpenseReportItem,
	travelExpenseReportItemConversion,
	travelExpenseReportPerDiem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import type { TravelExpenseReportSubmittedAdjustment } from "@/lib/approvals/evidence/travel-expense-report-adjustment";
import { loadTravelExpenseReportSubmittedRevision } from "@/lib/approvals/evidence/travel-expense-report-store";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type AdjustmentBaseline,
	type AdjustmentIneligibility,
	adjustmentEligibility,
	parseAdjustmentReason,
} from "./adjustment";
import {
	type AdjustmentExecutor,
	effectiveAdjustmentSource,
	loadAdjustmentBaseline,
	loadAdjustmentLink,
	loadAdjustmentSource,
} from "./adjustment-read";
import { copyAllowanceOverrides } from "./allowance-override-copy";
import { loadTravelExpenseReportExportState } from "./export-store";
import { isCarriedByPayrollRun } from "./payroll-run-inclusion-read";
import type { ReportOwner } from "./report-store";
import { hasRecordedSettlement } from "./settlement-store";

/**
 * Writes and owner reads of report adjustments (#615). The employee creates an
 * adjustment of their own exported or reimbursed report: a draft copy of the
 * latest approved facts (the original's, or the latest approved adjustment's)
 * linked to the original, which they correct and submit through the ordinary
 * report submission for fresh whole-report review. Nothing of the original
 * report, its decisions, exports or reimbursements is changed.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CreateAdjustmentResult =
	| { status: "created"; reportId: string; replayed: boolean }
	| { status: "not_found" }
	| { status: "invalid"; code: "required" | "too_long" }
	| { status: "ineligible"; reason: AdjustmentIneligibility }
	/** The key was used for another adjustment command. */
	| { status: "idempotency_conflict" };

/** Copies the editable facts of an approved report into a new draft adjustment report. */
async function copyApprovedReport(
	tx: Transaction,
	input: { owner: ReportOwner; sourceReportId: string; at: Date },
): Promise<string> {
	const { owner, at } = input;
	const [source] = await tx
		.select()
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.sourceReportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
			),
		)
		.limit(1);
	if (!source) throw new Error("Adjustment source report not found");
	const [report] = await tx
		.insert(travelExpenseReport)
		.values({
			organizationId: owner.organizationId,
			employeeId: owner.employeeId,
			kind: source.kind,
			status: "draft",
			reimbursementCurrency: source.reimbursementCurrency,
			tripPurpose: source.tripPurpose,
			tripStartDate: source.tripStartDate,
			tripEndDate: source.tripEndDate,
			tripTimeZone: source.tripTimeZone,
			tripDestinations: source.tripDestinations,
			projectId: source.projectId,
			createdAt: at,
			createdBy: owner.userId,
			updatedAt: at,
			updatedBy: owner.userId,
		})
		.returning({ id: travelExpenseReport.id });
	if (!report) throw new Error("Failed to create the adjustment report");

	const [items, receipts, conversions] = await Promise.all([
		tx
			.select()
			.from(travelExpenseReportItem)
			.where(
				and(
					eq(travelExpenseReportItem.reportId, source.id),
					eq(travelExpenseReportItem.organizationId, owner.organizationId),
				),
			)
			.orderBy(asc(travelExpenseReportItem.position)),
		tx
			.select()
			.from(travelExpenseReportReceipt)
			.where(
				and(
					eq(travelExpenseReportReceipt.reportId, source.id),
					eq(travelExpenseReportReceipt.organizationId, owner.organizationId),
				),
			)
			.orderBy(asc(travelExpenseReportReceipt.createdAt), asc(travelExpenseReportReceipt.id)),
		tx
			.select()
			.from(travelExpenseReportItemConversion)
			.where(
				and(
					eq(travelExpenseReportItemConversion.reportId, source.id),
					eq(travelExpenseReportItemConversion.organizationId, owner.organizationId),
					// Reference rates are derived again while the copy is a draft (#608).
					inArray(travelExpenseReportItemConversion.basis, ["card_charge", "manual_rate"]),
				),
			),
	]);
	const itemIds = new Map<string, string>();
	if (items.length > 0) {
		// One statement: positions are unique per report, so each copy maps back by its position.
		const copies = await tx
			.insert(travelExpenseReportItem)
			.values(
				items.map((item) => ({
					organizationId: owner.organizationId,
					reportId: report.id,
					type: item.type,
					position: item.position,
					expenseDate: item.expenseDate,
					category: item.category,
					description: item.description,
					originalAmount: item.originalAmount,
					originalCurrency: item.originalCurrency,
					paidBy: item.paidBy,
					accountingReference: item.accountingReference,
					mileageRoute: item.mileageRoute,
					mileageDistanceKm: item.mileageDistanceKm,
					mileageVehicle: item.mileageVehicle,
					// Priced afresh while a draft and stamped again at submission (#606).
					mileagePolicy: null,
					receiptExceptionReason: item.receiptExceptionReason,
					receiptExceptionVersion: item.receiptExceptionVersion,
					projectId: item.projectId,
					projectInherits: item.projectInherits,
					createdAt: at,
					updatedAt: at,
					updatedBy: owner.userId,
				})),
			)
			.returning({ id: travelExpenseReportItem.id, position: travelExpenseReportItem.position });
		const copyIdByPosition = new Map(copies.map((copy) => [copy.position, copy.id]));
		for (const item of items) {
			const copyId = copyIdByPosition.get(item.position);
			if (!copyId) throw new Error("Failed to copy an adjustment item");
			itemIds.set(item.id, copyId);
		}
	}
	// The copies name the same stored objects: the evidence is not uploaded again.
	const receiptIds = new Map<string, string>();
	const receiptCopies: (typeof travelExpenseReportReceipt.$inferInsert)[] = [];
	for (const receipt of receipts) {
		const itemId = itemIds.get(receipt.itemId);
		if (!itemId) continue;
		const id = randomUUID();
		receiptIds.set(receipt.id, id);
		receiptCopies.push({
			id,
			organizationId: owner.organizationId,
			reportId: report.id,
			itemId,
			storageProvider: receipt.storageProvider,
			storageBucket: receipt.storageBucket,
			storageKey: receipt.storageKey,
			storageVersionId: receipt.storageVersionId,
			fileName: receipt.fileName,
			mimeType: receipt.mimeType,
			sizeBytes: receipt.sizeBytes,
			checksumSha256: receipt.checksumSha256,
			uploadedBy: receipt.uploadedBy,
			createdAt: receipt.createdAt,
		});
	}
	if (receiptCopies.length > 0) await tx.insert(travelExpenseReportReceipt).values(receiptCopies);
	// Per diem itineraries (#609); the policy is stamped again at submission.
	const perDiems = await tx
		.select()
		.from(travelExpenseReportPerDiem)
		.where(
			and(
				eq(travelExpenseReportPerDiem.reportId, source.id),
				eq(travelExpenseReportPerDiem.organizationId, owner.organizationId),
			),
		);
	const perDiemCopies: (typeof travelExpenseReportPerDiem.$inferInsert)[] = [];
	for (const perDiem of perDiems) {
		const itemId = itemIds.get(perDiem.itemId);
		if (!itemId) continue;
		perDiemCopies.push({ ...perDiem, itemId, reportId: report.id, policy: null });
	}
	if (perDiemCopies.length > 0) await tx.insert(travelExpenseReportPerDiem).values(perDiemCopies);
	const conversionCopies: (typeof travelExpenseReportItemConversion.$inferInsert)[] = [];
	for (const conversion of conversions) {
		const itemId = itemIds.get(conversion.itemId);
		if (!itemId) continue;
		const { id: _id, reportId: _reportId, itemId: _itemId, ...facts } = conversion;
		conversionCopies.push({
			...facts,
			reportId: report.id,
			itemId,
			evidenceReceiptId: conversion.evidenceReceiptId
				? (receiptIds.get(conversion.evidenceReceiptId) ?? null)
				: null,
			createdAt: at,
			updatedAt: at,
		});
	}
	if (conversionCopies.length > 0) {
		await tx.insert(travelExpenseReportItemConversion).values(conversionCopies);
	}
	// Authorized allowance overrides (#610) are copied like manual rates.
	await copyAllowanceOverrides(tx, {
		organizationId: owner.organizationId,
		sourceReportId: source.id,
		targetReportId: report.id,
		itemIds,
	});
	return report.id;
}

/**
 * Creates a draft adjustment of the owner's exported or reimbursed report. The
 * original report row is locked (the settlement account lock), so the
 * eligibility read and the copy see one approved state. A retried command with
 * the same key returns the adjustment it created.
 */
export async function createTravelExpenseAdjustment(
	database: Database,
	input: { owner: ReportOwner; originalReportId: string; reason: string; idempotencyKey: string },
	now: Instant = systemClock.nowInstant(),
): Promise<CreateAdjustmentResult> {
	const { owner } = input;
	const reason = parseAdjustmentReason(input.reason);
	if (!reason.ok) return { status: "invalid", code: reason.code };
	return database.transaction(async (tx) => {
		const [original] = await tx
			.select({ id: travelExpenseReport.id, employeeId: travelExpenseReport.employeeId })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, input.originalReportId),
					eq(travelExpenseReport.organizationId, owner.organizationId),
					eq(travelExpenseReport.employeeId, owner.employeeId),
				),
			)
			.for("update");
		if (!original) return { status: "not_found" } as const;

		const [replay] = await tx
			.select()
			.from(travelExpenseReportAdjustment)
			.where(
				and(
					eq(travelExpenseReportAdjustment.organizationId, owner.organizationId),
					eq(travelExpenseReportAdjustment.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (replay) {
			return replay.originalReportId === original.id &&
				replay.createdByEmployeeId === owner.employeeId &&
				replay.reason === reason.reason
				? ({ status: "created", reportId: replay.reportId, replayed: true } as const)
				: ({ status: "idempotency_conflict" } as const);
		}

		const isAdjustment = Boolean(
			await loadAdjustmentLink(tx, { organizationId: owner.organizationId, reportId: original.id }),
		);
		const baseline = isAdjustment
			? null
			: await loadAdjustmentBaseline(tx, {
					organizationId: owner.organizationId,
					originalReportId: original.id,
				});
		const approved = baseline?.status === "ok";
		const source = { type: "report" as const, id: original.id };
		const [exportState, reimbursed, inPayrollRun] = approved
			? await Promise.all([
					loadTravelExpenseReportExportState(tx, {
						organizationId: owner.organizationId,
						reportId: original.id,
					}),
					hasRecordedSettlement(tx, { organizationId: owner.organizationId, source }),
					isCarriedByPayrollRun(tx, {
						organizationId: owner.organizationId,
						reportIds: [original.id],
					}),
				])
			: [null, false, false];
		const eligibility = adjustmentEligibility({
			approved,
			isAdjustment,
			// A payroll run's file carries it like an export (#853).
			exported: (exportState?.exported ?? false) || inPayrollRun,
			reimbursed,
		});
		if (!eligibility.ok) return { status: "ineligible", reason: eligibility.reason } as const;
		if (baseline?.status !== "ok") throw new Error("Unreachable: eligible without baseline");

		// Later corrections start from the then-effective approved facts.
		const { reportId: sourceReportId, revisionId: sourceRevisionId } =
			effectiveAdjustmentSource(baseline);
		const at = dateFromInstant(now);
		const reportId = await copyApprovedReport(tx, { owner, sourceReportId, at });
		await tx.insert(travelExpenseReportAdjustment).values({
			organizationId: owner.organizationId,
			reportId,
			originalReportId: original.id,
			sourceReportId,
			sourceRevisionId,
			reason: reason.reason,
			idempotencyKey: input.idempotencyKey,
			createdByEmployeeId: owner.employeeId,
			createdByUserId: owner.userId,
			createdAt: at,
		});
		return { status: "created", reportId, replayed: false } as const;
	});
}

export type SubmittedAdjustmentRefusal =
	| "original_not_approved"
	| "currency_mismatch"
	/**
	 * Another adjustment of the same report was approved after this one was
	 * copied: its facts still hold what that correction changed, so it would
	 * undo it. The employee starts a fresh adjustment from the current facts.
	 */
	| "source_superseded";

export type SubmittedAdjustmentBaseline =
	| { status: "none" }
	| { status: "ok"; baseline: AdjustmentBaseline }
	| { status: "refused"; reason: SubmittedAdjustmentRefusal };

/**
 * Submission of an adjustment report (`submitTravelExpenseReport`): the
 * baseline it is calculated against, read under the original report's lock so
 * no adjustment of it can be approved meanwhile. Other reports: `none`.
 */
export async function resolveSubmittedAdjustmentBaseline(
	tx: AdjustmentExecutor,
	input: { organizationId: string; reportId: string; reimbursementCurrency: string },
): Promise<SubmittedAdjustmentBaseline> {
	const link = await loadAdjustmentSource(tx, input);
	if (!link) return { status: "none" };
	const result = await loadAdjustmentBaseline(
		tx,
		{ organizationId: input.organizationId, originalReportId: link.originalReportId },
		{ lock: true },
	);
	if (result.status !== "ok") return { status: "refused", reason: "original_not_approved" };
	if (effectiveAdjustmentSource(result).revisionId !== link.sourceRevisionId) {
		return { status: "refused", reason: "source_superseded" };
	}
	if (result.baseline.currency !== input.reimbursementCurrency) {
		return { status: "refused", reason: "currency_mismatch" };
	}
	return { status: "ok", baseline: result.baseline };
}

export interface ReportAdjustmentSummary {
	reportId: string;
	status: TravelExpenseReportStatus;
	reason: string;
	createdAt: string;
	/** The frozen delta of its current submission; null while never submitted. */
	delta: string | null;
	currency: string | null;
	/** Counted in the original's entitlement. */
	applied: boolean;
}

export type ReportAdjustmentView =
	| {
			role: "original";
			/** Whether the owner may create an adjustment now, and why not. */
			eligibility: { ok: true } | { ok: false; reason: AdjustmentIneligibility };
			/** The effective approved entitlement, when the report is approved. */
			baseline: AdjustmentBaseline | null;
			adjustments: ReportAdjustmentSummary[];
	  }
	| {
			role: "adjustment";
			originalReportId: string;
			reason: string;
			/**
			 * Editable: the entitlement in force now (the delta follows from the live
			 * total). Submitted or decided: the frozen baseline and delta.
			 */
			baseline: AdjustmentBaseline | null;
			frozen: TravelExpenseReportSubmittedAdjustment | null;
	  };

/** The adjustment facts of one of the owner's reports, as its page shows them. */
export async function loadOwnReportAdjustments(
	database: Database,
	owner: Pick<ReportOwner, "organizationId" | "employeeId">,
	reportId: string,
): Promise<ReportAdjustmentView | null> {
	const [report] = await database
		.select({
			id: travelExpenseReport.id,
			status: travelExpenseReport.status,
			submissionCount: travelExpenseReport.submissionCount,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			),
		)
		.limit(1);
	if (!report) return null;
	const scope = { organizationId: owner.organizationId, reportId: report.id };
	const link = await loadAdjustmentLink(database, scope);
	if (link) {
		const revision =
			report.submissionCount > 0
				? await loadTravelExpenseReportSubmittedRevision(database, {
						...scope,
						submissionCycle: report.submissionCount,
					})
				: null;
		const frozen =
			report.status === "draft" || report.status === "returned"
				? null
				: (revision?.facts.adjustment ?? null);
		const current = frozen
			? null
			: await loadAdjustmentBaseline(database, {
					organizationId: owner.organizationId,
					originalReportId: link.originalReportId,
				});
		return {
			role: "adjustment",
			originalReportId: link.originalReportId,
			reason: link.reason,
			baseline: frozen?.baseline ?? (current?.status === "ok" ? current.baseline : null),
			frozen,
		};
	}
	const baseline =
		report.status === "approved"
			? await loadAdjustmentBaseline(database, {
					organizationId: owner.organizationId,
					originalReportId: report.id,
				})
			: null;
	const approved = baseline?.status === "ok";
	const [exportState, reimbursed, inPayrollRun] = approved
		? await Promise.all([
				loadTravelExpenseReportExportState(database, scope),
				hasRecordedSettlement(database, {
					organizationId: owner.organizationId,
					source: { type: "report", id: report.id },
				}),
				isCarriedByPayrollRun(database, {
					organizationId: owner.organizationId,
					reportIds: [report.id],
				}),
			])
		: [null, false, false];
	const links = await database
		.select({
			reportId: travelExpenseReportAdjustment.reportId,
			reason: travelExpenseReportAdjustment.reason,
			createdAt: travelExpenseReportAdjustment.createdAt,
			status: travelExpenseReport.status,
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
				eq(travelExpenseReportAdjustment.organizationId, owner.organizationId),
				eq(travelExpenseReportAdjustment.originalReportId, report.id),
			),
		)
		.orderBy(desc(travelExpenseReportAdjustment.createdAt));
	const appliedIds = new Set(
		baseline?.status === "ok" ? baseline.approved.map((entry) => entry.reportId) : [],
	);
	const adjustments = await Promise.all(
		links.map(async (row): Promise<ReportAdjustmentSummary> => {
			const revision =
				row.submissionCount > 0
					? await loadTravelExpenseReportSubmittedRevision(database, {
							organizationId: owner.organizationId,
							reportId: row.reportId,
							submissionCycle: row.submissionCount,
						})
					: null;
			const adjustment = revision?.facts.adjustment;
			return {
				reportId: row.reportId,
				status: row.status,
				reason: row.reason,
				createdAt: instantToCanonicalString(instantFromDate(row.createdAt)),
				delta: adjustment?.delta.amount ?? null,
				currency: adjustment?.delta.currency ?? null,
				applied: appliedIds.has(row.reportId),
			};
		}),
	);
	return {
		role: "original",
		eligibility: adjustmentEligibility({
			approved,
			isAdjustment: false,
			exported: (exportState?.exported ?? false) || inPayrollRun,
			reimbursed,
		}),
		baseline: baseline?.status === "ok" ? baseline.baseline : null,
		adjustments,
	};
}
