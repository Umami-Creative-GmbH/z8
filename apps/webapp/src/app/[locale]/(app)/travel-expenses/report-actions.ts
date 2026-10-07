"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { deletePrivateObject } from "@/lib/storage/export-s3-client";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	parseReceiptItemDraft,
	type ReceiptItemDraft,
	type ReceiptItemDraftInput,
	type ReceiptItemFieldError,
} from "@/lib/travel-expenses/receipt-report";
import { runTravelExpenseReceiptCleanup } from "@/lib/travel-expenses/receipt-upload";
import { removeReportReceipt } from "@/lib/travel-expenses/report-receipt-upload";
import {
	addTripReportItem,
	createStandaloneReceiptReport,
	createTripReport,
	type DraftReportSummary,
	listOwnDraftReports,
	listOwnSubmittedReports,
	loadOwnReport,
	type ReportItemView,
	type ReportOwner,
	type ReportView,
	removeTripReportItem,
	saveReceiptItemDraft,
	saveTripDetailsDraft,
	type TripDetailsView,
} from "@/lib/travel-expenses/report-store";
import {
	loadAuthorizedTravelExpenseReport,
	authorizedReportCycle,
	loadSubmittedReportView,
	type SubmittedReportView,
} from "@/lib/travel-expenses/report-read";
import type { ReviewedReportVersions } from "@/lib/travel-expenses/report-submission";
import {
	parseTripDetailsDraft,
	type TripDetailsDraft,
	type TripDetailsDraftInput,
	type TripDetailsFieldError,
} from "@/lib/travel-expenses/trip-report";
import {
	type SubmitTravelExpenseReportResult,
	submitTravelExpenseReport,
} from "@/lib/approvals/server/travel-expense-report-submission";

async function currentOwner(): Promise<ReportOwner | null> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

const uuid = z.uuid();

export async function createStandaloneReceiptReportAction(): Promise<
	ServerActionResult<{ reportId: string }>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const { reportId } = await createStandaloneReceiptReport(db, owner);
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
			actorId: owner.userId,
			employeeId: owner.employeeId,
			targetId: reportId,
			targetType: "approval",
			organizationId: owner.organizationId,
			metadata: { model: "report", kind: "standalone" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log expense report creation"));
		revalidatePath("/travel-expenses");
		return { success: true, data: { reportId } };
	} catch (error) {
		logger.error({ error }, "Failed to create expense report");
		return { success: false, error: "Failed to create expense report" };
	}
}

export async function createTripReportAction(): Promise<ServerActionResult<{ reportId: string }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		// Travel dates start out as calendar days in the employee's own zone.
		const timeZone = await getEffectiveTimezone(owner.userId, owner.organizationId);
		const { reportId } = await createTripReport(db, owner, { timeZone });
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
			actorId: owner.userId,
			employeeId: owner.employeeId,
			targetId: reportId,
			targetType: "approval",
			organizationId: owner.organizationId,
			metadata: { model: "report", kind: "trip" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log trip report creation"));
		revalidatePath("/travel-expenses");
		return { success: true, data: { reportId } };
	} catch (error) {
		logger.error({ error }, "Failed to create trip report");
		return { success: false, error: "Failed to create trip report" };
	}
}

export async function getMyDraftTravelExpenseReports(): Promise<
	ServerActionResult<DraftReportSummary[]>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		return { success: true, data: await listOwnDraftReports(db, owner) };
	} catch (error) {
		logger.error({ error }, "Failed to list draft expense reports");
		return { success: false, error: "Failed to load draft expense reports" };
	}
}

export async function getMySubmittedTravelExpenseReports(): Promise<
	ServerActionResult<DraftReportSummary[]>
> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		return { success: true, data: await listOwnSubmittedReports(db, owner) };
	} catch (error) {
		logger.error({ error }, "Failed to list submitted expense reports");
		return { success: false, error: "Failed to load submitted expense reports" };
	}
}

export async function getMyTravelExpenseReport(
	reportId: string,
): Promise<ServerActionResult<ReportView>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const report = uuid.safeParse(reportId).success
			? await loadOwnReport(db, owner, reportId)
			: null;
		if (!report) return { success: false, error: "Expense report not found" };
		return { success: true, data: report };
	} catch (error) {
		logger.error({ error }, "Failed to load expense report");
		return { success: false, error: "Failed to load expense report" };
	}
}

export type SaveReceiptItemOutcome =
	| { status: "saved"; item: ReportItemView }
	/** A newer version exists; the caller's edits were not written. */
	| { status: "conflict"; item: ReportItemView }
	| {
			status: "invalid";
			errors: Partial<Record<keyof ReceiptItemDraft, ReceiptItemFieldError>>;
	  };

const draftFieldSchema = z.string().max(2000).nullable();
const saveSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	values: z.object({
		expenseDate: draftFieldSchema,
		category: draftFieldSchema,
		description: draftFieldSchema,
		amount: draftFieldSchema,
		currency: draftFieldSchema,
		paidBy: draftFieldSchema,
		accountingReference: draftFieldSchema,
	}),
});

export async function saveReceiptItemDraftAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	values: ReceiptItemDraftInput;
}): Promise<ServerActionResult<SaveReceiptItemOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = saveSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid expense draft" };
		const parsed = parseReceiptItemDraft(parsedInput.data.values);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await saveReceiptItemDraft(db, owner, {
			reportId: parsedInput.data.reportId,
			itemId: parsedInput.data.itemId,
			expectedVersion: parsedInput.data.expectedVersion,
			draft: parsed.draft,
		});
		switch (result.kind) {
			case "saved":
			case "conflict":
				return { success: true, data: { status: result.kind, item: result.item } };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save expense draft");
		return { success: false, error: "Failed to save expense draft" };
	}
}

export type SaveTripDetailsOutcome =
	| { status: "saved"; details: TripDetailsView }
	/** Newer details exist; the caller's edits were not written. */
	| { status: "conflict"; details: TripDetailsView }
	| {
			status: "invalid";
			errors: Partial<Record<keyof TripDetailsDraft, TripDetailsFieldError>>;
	  };

const tripDetailsSchema = z.object({
	reportId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	values: z.object({
		purpose: draftFieldSchema,
		startDate: draftFieldSchema,
		endDate: draftFieldSchema,
		timeZone: draftFieldSchema,
		destinations: z
			.array(z.object({ place: draftFieldSchema, countryCode: draftFieldSchema }))
			.max(50),
	}),
});

export async function saveTripDetailsDraftAction(input: {
	reportId: string;
	expectedVersion: number;
	values: TripDetailsDraftInput;
}): Promise<ServerActionResult<SaveTripDetailsOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsedInput = tripDetailsSchema.safeParse(input);
		if (!parsedInput.success) return { success: false, error: "Invalid trip details" };
		const parsed = parseTripDetailsDraft(parsedInput.data.values);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await saveTripDetailsDraft(db, owner, {
			reportId: parsedInput.data.reportId,
			expectedVersion: parsedInput.data.expectedVersion,
			details: parsed.draft,
		});
		switch (result.kind) {
			case "saved":
			case "conflict":
				return { success: true, data: { status: result.kind, details: result.details } };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save trip details");
		return { success: false, error: "Failed to save trip details" };
	}
}

export async function addTripReportItemAction(input: {
	reportId: string;
}): Promise<ServerActionResult<{ item: ReportItemView }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!uuid.safeParse(input.reportId).success)
			return { success: false, error: "Expense report not found" };
		const result = await addTripReportItem(db, owner, { reportId: input.reportId });
		switch (result.kind) {
			case "added":
				return { success: true, data: { item: result.item } };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to add expense");
		return { success: false, error: "Failed to add expense" };
	}
}

export type RemoveTripReportItemOutcome =
	| { status: "removed"; itemId: string }
	/** The expense changed elsewhere since the caller saw it; it was kept. */
	| { status: "conflict"; item: ReportItemView };

export async function removeTripReportItemAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
}): Promise<ServerActionResult<RemoveTripReportItemOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (
			![input.reportId, input.itemId].every((id) => uuid.safeParse(id).success) ||
			!Number.isInteger(input.expectedVersion)
		)
			return { success: false, error: "Expense not found" };
		const result = await removeTripReportItem(db, owner, input);
		switch (result.kind) {
			case "conflict":
				return { success: true, data: { status: "conflict", item: result.item } };
			case "item_not_found":
				return { success: false, error: "Expense not found" };
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
			case "removed":
				break;
		}
		// The objects are already recorded for durable cleanup; try to delete them now.
		for (const receiptId of result.receiptIds) {
			await runTravelExpenseReceiptCleanup(db, {
				deleteObject: deletePrivateObject,
				only: { attachmentId: receiptId, organizationId: owner.organizationId },
			}).catch((error) => logger.warn({ error }, "Deferred removed receipt cleanup"));
		}
		return { success: true, data: { status: "removed", itemId: result.itemId } };
	} catch (error) {
		logger.error({ error }, "Failed to remove expense");
		return { success: false, error: "Failed to remove expense" };
	}
}

type SubmitRefusal = Exclude<
	SubmitTravelExpenseReportResult,
	{ kind: "submitted" | "not_found" | "not_draft" }
>;

/**
 * What the employee is told: submitted, or the submission owner's refusal
 * (e.g. changed since review, incomplete, no reviewer) with its guidance data.
 * Server-side routing messages stay in the logs.
 */
export type SubmitTravelExpenseReportOutcome =
	| { status: "submitted" }
	| {
			[K in SubmitRefusal["kind"]]: { status: K } & Omit<
				Extract<SubmitRefusal, { kind: K }>,
				"kind" | "message"
			>;
	  }[SubmitRefusal["kind"]];

const submitSchema = z.object({
	reportId: z.uuid(),
	reviewed: z.object({
		detailsVersion: z.number().int().positive().nullable(),
		items: z
			.array(
				z.object({
					id: z.uuid(),
					version: z.number().int().positive(),
					receiptIds: z.array(z.uuid()).max(100),
					receiptExceptionVersion: z.number().int().nonnegative().optional(),
					referenceRate: z.string().max(200).nullable().optional(),
					amount: z.string().max(20).nullable().optional(),
				}),
			)
			.max(200),
	}),
});

/**
 * Submits the saved report exactly as the employee reviewed it (#602). The
 * server checks completeness, calculates the totals and freezes the revision.
 */
export async function submitTravelExpenseReportAction(input: {
	reportId: string;
	reviewed: ReviewedReportVersions;
}): Promise<ServerActionResult<SubmitTravelExpenseReportOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = submitSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Expense report not found" };
		const result = await submitTravelExpenseReport(db, {
			owner,
			reportId: parsed.data.reportId,
			reviewed: parsed.data.reviewed,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "not_draft":
				return { success: false, error: "This expense report was already submitted" };
			case "submitted":
				break;
			case "routing_failed":
				logger.warn(
					{ reportId: parsed.data.reportId, message: result.message },
					"Expense report routing failed",
				);
				return { success: true, data: { status: "routing_failed" } };
			case "incomplete":
				return { success: true, data: { status: result.kind, missing: result.missing } };
			case "project_ineligible":
				return { success: true, data: { status: result.kind, itemIds: result.itemIds } };
			case "no_reviewer":
				return { success: true, data: { status: result.kind, reason: result.reason } };
			case "threshold_currency_unsupported":
				return { success: true, data: { status: result.kind, currency: result.currency } };
			case "adjustment_unavailable":
				return { success: true, data: { status: result.kind, reason: result.reason } };
			case "changed_since_review":
			case "self_approval_route":
			case "authority_unsupported":
				return { success: true, data: { status: result.kind } };
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_SUBMITTED,
			actorId: owner.userId,
			employeeId: owner.employeeId,
			targetId: parsed.data.reportId,
			targetType: "approval",
			organizationId: owner.organizationId,
			metadata: {
				model: "report",
				approverId: result.reviewerEmployeeId,
				submissionCycle: result.submissionCycle,
				submittedRevisionId: result.submittedRevisionId,
			},
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log expense report submission"));
		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "submitted" } };
	} catch (error) {
		logger.error({ error }, "Failed to submit expense report");
		return { success: false, error: "Failed to submit expense report" };
	}
}

/**
 * A frozen submission, for the report's owner or an authorized reviewer: the
 * latest, or the earlier cycle `cycle` names (#603).
 */
export async function getTravelExpenseReportSubmission(
	reportId: string,
	cycle?: number,
): Promise<ServerActionResult<SubmittedReportView>> {
	try {
		const authorized = await loadAuthorizedTravelExpenseReport(reportId);
		if (authorized.status === "unauthorized") return { success: false, error: "Unauthorized" };
		// A reviewer reads only the cycles they are authorized to review.
		const readableCycle =
			authorized.status === "found" ? authorizedReportCycle(authorized, cycle) : null;
		const view =
			authorized.status === "found" && readableCycle !== null
				? await loadSubmittedReportView(authorized.report, authorized.access, readableCycle)
				: null;
		if (!view) return { success: false, error: "Expense report not found" };
		return { success: true, data: view };
	} catch (error) {
		logger.error({ error }, "Failed to load submitted expense report");
		return { success: false, error: "Failed to load expense report" };
	}
}

export async function removeReportReceiptAction(input: {
	reportId: string;
	itemId: string;
	receiptId: string;
}): Promise<ServerActionResult<{ receiptId: string }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (![input.reportId, input.itemId, input.receiptId].every((id) => uuid.safeParse(id).success))
			return { success: false, error: "Receipt not found" };
		const result = await removeReportReceipt(db, owner, input);
		if (result.kind === "not_draft")
			return { success: false, error: "This expense can no longer be edited" };
		if (result.kind === "not_found") return { success: false, error: "Receipt not found" };
		// The object is already recorded for durable cleanup; try to delete it now.
		await runTravelExpenseReceiptCleanup(db, {
			deleteObject: deletePrivateObject,
			only: { attachmentId: result.receiptId, organizationId: owner.organizationId },
		}).catch((error) => logger.warn({ error }, "Deferred removed receipt cleanup"));
		return { success: true, data: { receiptId: result.receiptId } };
	} catch (error) {
		logger.error({ error }, "Failed to remove receipt");
		return { success: false, error: "Failed to remove receipt" };
	}
}
