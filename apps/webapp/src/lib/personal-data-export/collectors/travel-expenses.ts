/**
 * Travel expenses category of a personal data export (#811, #1169).
 *
 * The employee's legacy claims with their decisions, and their reports with
 * items, per diem itineraries, currency conversions, allowance overrides,
 * review cycles and notes, adjustments, legacy draft conversions, settlement
 * entries and payroll run inclusions, plus project attribution exceptions
 * granted for them. Every receipt is copied into the archive as its original
 * file under `travel_expenses/`, read and verified against its recorded size
 * and checksum only while the archive is written; rows reference it by its
 * path inside the ZIP (`file`). Storage identity (key, bucket, version,
 * checksum) and technical keys are never exported, also not inside JSON.
 *
 * Withheld from the employee export (decisions-811): only the reason and
 * evidence of project attribution exceptions, the internal notes of the
 * expense administrators. The settlement note stays: the employee sees it.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
	payrollExportJob,
	project,
	travelExpenseAllowanceOverride,
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseDecisionLog,
	travelExpenseLegacyDraftConversion,
	travelExpensePayrollRunInclusion,
	travelExpenseProjectAttributionException,
	travelExpenseReport,
	travelExpenseReportAdjustment,
	travelExpenseReportCycleClosure,
	travelExpenseReportItem,
	travelExpenseReportItemConversion,
	travelExpenseReportPerDiem,
	travelExpenseReportReceipt,
	travelExpenseReportReviewNote,
	travelExpenseSettlementEntry,
} from "@/db/schema";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "@/lib/travel-expenses/attachment-validation";
import { bundleReceiptFileName, bundleReceiptPath } from "@/lib/travel-expenses/export-manifest";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataFile,
	tablePart,
} from "../collector";
import { jsonWithoutStorageReferences } from "../storage-references";
import { instantText, loadEmployeeNames, loadUserNames, nameOf } from "../values";
import { travelExpensesFieldGuide } from "./travel-expenses-fields";

const CATEGORY = "travel_expenses";

export const travelExpensesCollector: PersonalDataCollector = {
	category: CATEGORY,
	collect: collectTravelExpenses,
	fields: travelExpensesFieldGuide,
};

interface StoredReceipt {
	organizationId: string;
	storageProvider: string;
	storageKey: string;
	storageBucket: string | null;
	storageVersionId: string | null;
	sizeBytes: number | null;
	checksumSha256: string | null;
}

/**
 * Reads a receipt's stored object and refuses it unless it still matches the
 * recorded size and checksum (historical legacy uploads may lack them).
 */
async function readVerifiedReceipt(receipt: StoredReceipt): Promise<Uint8Array> {
	if (receipt.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
		throw new Error("Unsupported recorded receipt storage provider");
	}
	const bytes = await readPrivateObject({
		organizationId: receipt.organizationId,
		key: receipt.storageKey,
		bucket: receipt.storageBucket,
		versionId: receipt.storageVersionId,
	});
	if (
		(receipt.sizeBytes !== null && bytes.byteLength !== receipt.sizeBytes) ||
		(receipt.checksumSha256 &&
			createHash("sha256").update(bytes).digest("hex") !== receipt.checksumSha256)
	) {
		throw new Error("Stored receipt content does not match its recorded identity");
	}
	return bytes;
}

function archivePath(path: string): string {
	return `${CATEGORY}/${path}`;
}

/** A plain JSON scalar for a numeric or text column. */
function text(value: string | number | null | undefined): string | null {
	return value === null || value === undefined ? null : String(value);
}

async function collectTravelExpenses(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	const files: PersonalDataFile[] = [];

	const [claims, reports, exceptions] = await Promise.all([
		database
			.select()
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, organizationId),
					eq(travelExpenseClaim.employeeId, employeeId),
				),
			)
			.orderBy(asc(travelExpenseClaim.createdAt), asc(travelExpenseClaim.id)),
		database
			.select()
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.organizationId, organizationId),
					eq(travelExpenseReport.employeeId, employeeId),
				),
			)
			.orderBy(asc(travelExpenseReport.createdAt), asc(travelExpenseReport.id)),
		database
			.select()
			.from(travelExpenseProjectAttributionException)
			.where(
				and(
					eq(travelExpenseProjectAttributionException.organizationId, organizationId),
					eq(travelExpenseProjectAttributionException.employeeId, employeeId),
				),
			)
			.orderBy(
				asc(travelExpenseProjectAttributionException.authorizedAt),
				asc(travelExpenseProjectAttributionException.id),
			),
	]);
	const claimIds = claims.map((claim) => claim.id);
	const reportIds = reports.map((report) => report.id);
	const ofClaims = <T>(load: (ids: string[]) => Promise<T[]>) =>
		claimIds.length === 0 ? Promise.resolve([] as T[]) : load(claimIds);
	const ofReports = <T>(load: (ids: string[]) => Promise<T[]>) =>
		reportIds.length === 0 ? Promise.resolve([] as T[]) : load(reportIds);

	const [
		attachments,
		decisions,
		items,
		receipts,
		perDiems,
		conversions,
		overrides,
		closures,
		adjustments,
		draftConversions,
		inclusions,
	] = await Promise.all([
		ofClaims((ids) =>
			database
				.select()
				.from(travelExpenseAttachment)
				.where(
					and(
						eq(travelExpenseAttachment.organizationId, organizationId),
						inArray(travelExpenseAttachment.claimId, ids),
					),
				)
				.orderBy(asc(travelExpenseAttachment.createdAt), asc(travelExpenseAttachment.id)),
		),
		ofClaims((ids) =>
			database
				.select()
				.from(travelExpenseDecisionLog)
				.where(
					and(
						eq(travelExpenseDecisionLog.organizationId, organizationId),
						inArray(travelExpenseDecisionLog.claimId, ids),
					),
				)
				.orderBy(asc(travelExpenseDecisionLog.createdAt), asc(travelExpenseDecisionLog.id)),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportItem)
				.where(
					and(
						eq(travelExpenseReportItem.organizationId, organizationId),
						inArray(travelExpenseReportItem.reportId, ids),
					),
				)
				.orderBy(asc(travelExpenseReportItem.reportId), asc(travelExpenseReportItem.position)),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportReceipt)
				.where(
					and(
						eq(travelExpenseReportReceipt.organizationId, organizationId),
						inArray(travelExpenseReportReceipt.reportId, ids),
					),
				)
				.orderBy(asc(travelExpenseReportReceipt.createdAt), asc(travelExpenseReportReceipt.id)),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportPerDiem)
				.where(
					and(
						eq(travelExpenseReportPerDiem.organizationId, organizationId),
						inArray(travelExpenseReportPerDiem.reportId, ids),
					),
				),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportItemConversion)
				.where(
					and(
						eq(travelExpenseReportItemConversion.organizationId, organizationId),
						inArray(travelExpenseReportItemConversion.reportId, ids),
					),
				)
				.orderBy(asc(travelExpenseReportItemConversion.createdAt)),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseAllowanceOverride)
				.where(
					and(
						eq(travelExpenseAllowanceOverride.organizationId, organizationId),
						inArray(travelExpenseAllowanceOverride.reportId, ids),
					),
				)
				.orderBy(asc(travelExpenseAllowanceOverride.authorizedAt)),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportCycleClosure)
				.where(
					and(
						eq(travelExpenseReportCycleClosure.organizationId, organizationId),
						inArray(travelExpenseReportCycleClosure.reportId, ids),
					),
				)
				.orderBy(
					asc(travelExpenseReportCycleClosure.reportId),
					asc(travelExpenseReportCycleClosure.submissionCycle),
				),
		),
		ofReports((ids) =>
			database
				.select()
				.from(travelExpenseReportAdjustment)
				.where(
					and(
						eq(travelExpenseReportAdjustment.organizationId, organizationId),
						inArray(travelExpenseReportAdjustment.reportId, ids),
					),
				)
				.orderBy(asc(travelExpenseReportAdjustment.createdAt)),
		),
		database
			.select()
			.from(travelExpenseLegacyDraftConversion)
			.where(
				and(
					eq(travelExpenseLegacyDraftConversion.organizationId, organizationId),
					eq(travelExpenseLegacyDraftConversion.employeeId, employeeId),
				),
			)
			.orderBy(asc(travelExpenseLegacyDraftConversion.convertedAt)),
		database
			.select({
				inclusion: travelExpensePayrollRunInclusion,
				filters: payrollExportJob.filters,
			})
			.from(travelExpensePayrollRunInclusion)
			.innerJoin(
				payrollExportJob,
				and(
					eq(payrollExportJob.id, travelExpensePayrollRunInclusion.payrollExportJobId),
					eq(payrollExportJob.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.employeeId, employeeId),
				),
			)
			.orderBy(asc(travelExpensePayrollRunInclusion.includedAt)),
	]);

	const sourceConditions = [
		...(reportIds.length > 0 ? [inArray(travelExpenseSettlementEntry.reportId, reportIds)] : []),
		...(claimIds.length > 0 ? [inArray(travelExpenseSettlementEntry.legacyClaimId, claimIds)] : []),
	];
	const closureIds = closures.map((closure) => closure.id);
	const [settlements, reviewNotes] = await Promise.all([
		sourceConditions.length === 0
			? []
			: database
					.select()
					.from(travelExpenseSettlementEntry)
					.where(
						and(
							eq(travelExpenseSettlementEntry.organizationId, organizationId),
							or(...sourceConditions),
						),
					)
					.orderBy(
						asc(travelExpenseSettlementEntry.recordedAt),
						asc(travelExpenseSettlementEntry.id),
					),
		closureIds.length === 0
			? []
			: database
					.select()
					.from(travelExpenseReportReviewNote)
					.where(
						and(
							eq(travelExpenseReportReviewNote.organizationId, organizationId),
							inArray(travelExpenseReportReviewNote.closureId, closureIds),
						),
					)
					.orderBy(asc(travelExpenseReportReviewNote.createdAt)),
	]);

	const settlementRunIds = [
		...new Set(settlements.flatMap((entry) => (entry.payrollRunId ? [entry.payrollRunId] : []))),
	];
	const settlementRuns =
		settlementRunIds.length === 0
			? []
			: await database
					.select({ id: payrollExportJob.id, filters: payrollExportJob.filters })
					.from(payrollExportJob)
					.where(
						and(
							eq(payrollExportJob.organizationId, organizationId),
							inArray(payrollExportJob.id, settlementRunIds),
						),
					);
	const runPeriods = new Map(settlementRuns.map((run) => [run.id, run.filters.dateRange]));

	const projectIds = [
		...reports.map((report) => report.projectId),
		...claims.map((claim) => claim.projectId),
		...items.map((item) => item.projectId),
		...exceptions.map((exception) => exception.projectId),
	].filter((id): id is string => Boolean(id));
	const projects =
		projectIds.length === 0
			? []
			: await database
					.select({ id: project.id, name: project.name })
					.from(project)
					.where(
						and(
							eq(project.organizationId, organizationId),
							inArray(project.id, [...new Set(projectIds)]),
						),
					);
	const projectNames = new Map(projects.map((row) => [row.id, row.name]));
	const projectName = (id: string | null) => (id ? (projectNames.get(id) ?? null) : null);

	const [userNames, employeeNames] = await Promise.all([
		loadUserNames(database, [
			...claims.flatMap((claim) => [claim.createdBy, claim.updatedBy]),
			...reports.flatMap((report) => [report.createdBy, report.updatedBy]),
			...items.map((item) => item.updatedBy),
			...conversions.map((conversion) => conversion.recordedBy),
			...closures.map((closure) => closure.actorUserId),
			...adjustments.map((adjustment) => adjustment.createdByUserId),
			...draftConversions.map((conversion) => conversion.convertedByUserId),
			...settlements.map((entry) => entry.recordedByUserId),
			...inclusions.map((row) => row.inclusion.endedByUserId),
			...exceptions.map((exception) => exception.authorizedByUserId),
		]),
		loadEmployeeNames(database, organizationId, [
			...claims.map((claim) => claim.approverId),
			...attachments.map((attachment) => attachment.uploadedBy),
			...decisions.flatMap((decision) => [decision.actorEmployeeId, decision.approverId]),
			...receipts.map((receipt) => receipt.uploadedBy),
			...closures.map((closure) => closure.actorEmployeeId),
			...adjustments.map((adjustment) => adjustment.createdByEmployeeId),
			...settlements.map((entry) => entry.recordedByEmployeeId),
			...exceptions.map((exception) => exception.authorizedByEmployeeId),
		]),
	]);
	const userName = (id: string | null) => nameOf(userNames, id);
	const employeeName = (id: string | null) => nameOf(employeeNames, id);

	// Original receipt files, each read only when the archive writer reaches it.
	const claimReceiptRows = attachments.map((attachment) => {
		const path = `claim-receipts/${attachment.claimId}/${attachment.id}-${bundleReceiptFileName(
			attachment.fileName,
			attachment.mimeType ?? "",
		)}`;
		files.push({ path, read: () => readVerifiedReceipt(attachment) });
		return {
			id: attachment.id,
			claim_id: attachment.claimId,
			file_name: attachment.fileName,
			mime_type: attachment.mimeType,
			size_bytes: attachment.sizeBytes,
			uploaded_by: employeeName(attachment.uploadedBy),
			created_at: instantText(attachment.createdAt),
			file: archivePath(path),
		};
	});
	const itemPositions = new Map(items.map((item) => [item.id, item.position]));
	const receiptPaths = new Map<string, string>();
	const reportReceiptRows = receipts.map((receipt) => {
		const path = bundleReceiptPath({
			reportId: receipt.reportId,
			itemPosition: itemPositions.get(receipt.itemId) ?? 0,
			receiptId: receipt.id,
			fileName: receipt.fileName,
			mimeType: receipt.mimeType,
		});
		files.push({ path, read: () => readVerifiedReceipt(receipt) });
		receiptPaths.set(receipt.id, archivePath(path));
		return {
			id: receipt.id,
			report_id: receipt.reportId,
			item_id: receipt.itemId,
			file_name: receipt.fileName,
			mime_type: receipt.mimeType,
			size_bytes: receipt.sizeBytes,
			uploaded_by: employeeName(receipt.uploadedBy),
			created_at: instantText(receipt.createdAt),
			file: archivePath(path),
		};
	});

	const withheld = scope.kind === "admin";
	const parts = [
		tablePart(
			"claims",
			[
				"id",
				"type",
				"status",
				"trip_start",
				"trip_end",
				"trip_start_date",
				"trip_end_date",
				"trip_date_time_zone",
				"destination_city",
				"destination_country",
				"project",
				"original_amount",
				"original_currency",
				"calculated_amount",
				"calculated_currency",
				"notes",
				"approver",
				"submitted_at",
				"decided_at",
				"created_at",
				"created_by",
				"updated_at",
				"updated_by",
			],
			claims.map((claim) => ({
				id: claim.id,
				type: claim.type,
				status: claim.status,
				trip_start: instantText(claim.tripStart),
				trip_end: instantText(claim.tripEnd),
				trip_start_date: claim.tripStartDate,
				trip_end_date: claim.tripEndDate,
				trip_date_time_zone: claim.tripDateTimeZone,
				destination_city: claim.destinationCity,
				destination_country: claim.destinationCountry,
				project: projectName(claim.projectId),
				original_amount: claim.originalAmount,
				original_currency: claim.originalCurrency,
				calculated_amount: claim.calculatedAmount,
				calculated_currency: claim.calculatedCurrency,
				notes: claim.notes,
				approver: employeeName(claim.approverId),
				submitted_at: instantText(claim.submittedAt),
				decided_at: instantText(claim.decidedAt),
				created_at: instantText(claim.createdAt),
				created_by: userName(claim.createdBy),
				updated_at: instantText(claim.updatedAt),
				updated_by: userName(claim.updatedBy),
			})),
		),
		tablePart(
			"claim_receipts",
			[
				"id",
				"claim_id",
				"file_name",
				"mime_type",
				"size_bytes",
				"uploaded_by",
				"created_at",
				"file",
			],
			claimReceiptRows,
		),
		tablePart(
			"claim_decisions",
			["claim_id", "action", "reason", "comment", "actor", "approver", "created_at"],
			decisions.map((decision) => ({
				claim_id: decision.claimId,
				action: decision.action,
				reason: decision.reason,
				comment: decision.comment,
				actor: employeeName(decision.actorEmployeeId),
				approver: employeeName(decision.approverId),
				created_at: instantText(decision.createdAt),
			})),
		),
		tablePart(
			"reports",
			[
				"id",
				"kind",
				"status",
				"reimbursement_currency",
				"trip_purpose",
				"trip_start_date",
				"trip_end_date",
				"trip_time_zone",
				"trip_destinations",
				"project",
				"submission_count",
				"submitted_at",
				"decided_at",
				"created_at",
				"created_by",
				"updated_at",
				"updated_by",
			],
			reports.map((report) => ({
				id: report.id,
				kind: report.kind,
				status: report.status,
				reimbursement_currency: report.reimbursementCurrency,
				trip_purpose: report.tripPurpose,
				trip_start_date: report.tripStartDate,
				trip_end_date: report.tripEndDate,
				trip_time_zone: report.tripTimeZone,
				trip_destinations: jsonWithoutStorageReferences(report.tripDestinations),
				project: projectName(report.projectId),
				submission_count: report.submissionCount,
				submitted_at: instantText(report.submittedAt),
				decided_at: instantText(report.decidedAt),
				created_at: instantText(report.createdAt),
				created_by: userName(report.createdBy),
				updated_at: instantText(report.updatedAt),
				updated_by: userName(report.updatedBy),
			})),
		),
		tablePart(
			"report_items",
			[
				"id",
				"report_id",
				"type",
				"position",
				"expense_date",
				"category",
				"description",
				"original_amount",
				"original_currency",
				"paid_by",
				"accounting_reference",
				"mileage_route",
				"mileage_distance_km",
				"mileage_vehicle",
				"mileage_policy",
				"receipt_exception_reason",
				"project",
				"project_inherits",
				"created_at",
				"updated_at",
				"updated_by",
			],
			items.map((item) => ({
				id: item.id,
				report_id: item.reportId,
				type: item.type,
				position: item.position,
				expense_date: item.expenseDate,
				category: item.category,
				description: item.description,
				original_amount: item.originalAmount,
				original_currency: item.originalCurrency,
				paid_by: item.paidBy,
				accounting_reference: item.accountingReference,
				mileage_route: item.mileageRoute,
				mileage_distance_km: item.mileageDistanceKm,
				mileage_vehicle: item.mileageVehicle,
				mileage_policy: jsonWithoutStorageReferences(item.mileagePolicy),
				receipt_exception_reason: item.receiptExceptionReason,
				project: projectName(item.projectId),
				project_inherits: item.projectInherits,
				created_at: instantText(item.createdAt),
				updated_at: instantText(item.updatedAt),
				updated_by: userName(item.updatedBy),
			})),
		),
		tablePart(
			"report_receipts",
			[
				"id",
				"report_id",
				"item_id",
				"file_name",
				"mime_type",
				"size_bytes",
				"uploaded_by",
				"created_at",
				"file",
			],
			reportReceiptRows,
		),
		tablePart(
			"per_diem_itineraries",
			[
				"item_id",
				"report_id",
				"start_date",
				"start_time",
				"start_time_zone",
				"end_date",
				"end_time",
				"end_time_zone",
				"overnight",
				"prolonged_workplace",
				"meals",
				"policy",
			],
			perDiems.map((perDiem) => ({
				item_id: perDiem.itemId,
				report_id: perDiem.reportId,
				start_date: perDiem.startDate,
				start_time: perDiem.startTime,
				start_time_zone: perDiem.startTimeZone,
				end_date: perDiem.endDate,
				end_time: perDiem.endTime,
				end_time_zone: perDiem.endTimeZone,
				overnight: perDiem.overnight,
				prolonged_workplace: perDiem.prolongedWorkplace,
				meals: jsonWithoutStorageReferences(perDiem.meals),
				policy: jsonWithoutStorageReferences(perDiem.policy),
			})),
		),
		tablePart(
			"currency_conversions",
			[
				"item_id",
				"report_id",
				"basis",
				"source_currency",
				"target_currency",
				"charged_amount",
				"rate",
				"rate_base_currency",
				"rate_quote_currency",
				"rate_date",
				"reason",
				"rate_evidence",
				"evidence_receipt_file",
				"reference_source",
				"reference_expense_date",
				"authorized_by",
				"authorized_at",
				"recorded_by",
				"created_at",
				"updated_at",
			],
			conversions.map((conversion) => ({
				item_id: conversion.itemId,
				report_id: conversion.reportId,
				basis: conversion.basis,
				source_currency: conversion.sourceCurrency,
				target_currency: conversion.targetCurrency,
				charged_amount: conversion.chargedAmount,
				rate: conversion.rate,
				rate_base_currency: conversion.rateBaseCurrency,
				rate_quote_currency: conversion.rateQuoteCurrency,
				rate_date: conversion.rateDate,
				reason: conversion.reason,
				rate_evidence: conversion.rateEvidence,
				evidence_receipt_file: conversion.evidenceReceiptId
					? (receiptPaths.get(conversion.evidenceReceiptId) ?? null)
					: null,
				reference_source: jsonWithoutStorageReferences(conversion.referenceSource),
				reference_expense_date: conversion.referenceExpenseDate,
				// Stored by value: the authorizer's name when they authorized it.
				authorized_by: conversion.authorizedByName,
				authorized_at: instantText(conversion.authorizedAt),
				recorded_by: userName(conversion.recordedBy),
				created_at: instantText(conversion.createdAt),
				updated_at: instantText(conversion.updatedAt),
			})),
		),
		tablePart(
			"allowance_overrides",
			[
				"id",
				"report_id",
				"item_id",
				"kind",
				"amount",
				"currency",
				"reason",
				"evidence",
				"calculation_basis",
				"scope",
				"situation",
				"authorized_by",
				"authorized_at",
				"revoked_by",
				"revoked_at",
			],
			overrides.map((override) => ({
				id: override.id,
				report_id: override.reportId,
				item_id: override.itemId,
				kind: override.kind,
				amount: override.amount,
				currency: override.currency,
				reason: override.reason,
				evidence: override.evidence,
				calculation_basis: override.calculationBasis,
				scope: jsonWithoutStorageReferences(override.scope),
				situation: jsonWithoutStorageReferences(override.situation),
				authorized_by: override.authorizedByName,
				authorized_at: instantText(override.authorizedAt),
				revoked_by: override.revokedByName,
				revoked_at: instantText(override.revokedAt),
			})),
		),
		tablePart(
			"review_cycle_closures",
			["id", "report_id", "submission_cycle", "kind", "note", "actor", "created_at"],
			closures.map((closure) => ({
				id: closure.id,
				report_id: closure.reportId,
				submission_cycle: closure.submissionCycle,
				kind: closure.kind,
				note: closure.note,
				actor: userName(closure.actorUserId) ?? employeeName(closure.actorEmployeeId),
				created_at: instantText(closure.createdAt),
			})),
		),
		tablePart(
			"review_notes",
			["closure_id", "item_id", "body", "created_at"],
			reviewNotes.map((note) => ({
				closure_id: note.closureId,
				item_id: note.itemId,
				body: note.body,
				created_at: instantText(note.createdAt),
			})),
		),
		tablePart(
			"adjustments",
			["report_id", "original_report_id", "source_report_id", "reason", "created_by", "created_at"],
			adjustments.map((adjustment) => ({
				report_id: adjustment.reportId,
				original_report_id: adjustment.originalReportId,
				source_report_id: adjustment.sourceReportId,
				reason: adjustment.reason,
				created_by:
					userName(adjustment.createdByUserId) ?? employeeName(adjustment.createdByEmployeeId),
				created_at: instantText(adjustment.createdAt),
			})),
		),
		tablePart(
			"legacy_draft_conversions",
			["claim_id", "report_id", "item_id", "legacy_facts", "flags", "converted_by", "converted_at"],
			draftConversions.map((conversion) => ({
				claim_id: conversion.claimId,
				report_id: conversion.reportId,
				item_id: conversion.itemId,
				// The snapshot names the legacy attachments' stored objects: stripped.
				legacy_facts: jsonWithoutStorageReferences(conversion.legacyFacts),
				flags: jsonWithoutStorageReferences(conversion.flags),
				converted_by: userName(conversion.convertedByUserId),
				converted_at: instantText(conversion.convertedAt),
			})),
		),
		tablePart(
			"settlement_entries",
			[
				"id",
				"source_type",
				"report_id",
				"legacy_claim_id",
				"kind",
				"amount",
				"currency",
				"occurred_on",
				"reference",
				"note",
				"basis_submission_cycle",
				"balance_before",
				"recorded_by",
				"recorded_at",
				"export_batch_id",
				"payroll_run_id",
				"payroll_run_period_start",
				"payroll_run_period_end",
			],
			settlements.map((entry) => {
				const period = entry.payrollRunId ? runPeriods.get(entry.payrollRunId) : undefined;
				return {
					id: entry.id,
					source_type: entry.sourceType,
					report_id: entry.reportId,
					legacy_claim_id: entry.legacyClaimId,
					kind: entry.kind,
					amount: entry.amount,
					currency: entry.currency,
					occurred_on: entry.occurredOn,
					reference: entry.reference,
					note: entry.note,
					basis_submission_cycle: entry.basisSubmissionCycle,
					balance_before: entry.balanceBefore,
					recorded_by: userName(entry.recordedByUserId) ?? employeeName(entry.recordedByEmployeeId),
					recorded_at: instantText(entry.recordedAt),
					export_batch_id: entry.exportBatchId,
					payroll_run_id: entry.payrollRunId,
					payroll_run_period_start: text(period?.start),
					payroll_run_period_end: text(period?.end),
				};
			}),
		),
		tablePart(
			"payroll_run_inclusions",
			[
				"report_id",
				"payroll_run_id",
				"payroll_run_period_start",
				"payroll_run_period_end",
				"lines",
				"state",
				"included_at",
				"ended_at",
				"ended_by",
			],
			inclusions.map(({ inclusion, filters }) => ({
				report_id: inclusion.reportId,
				payroll_run_id: inclusion.payrollExportJobId,
				payroll_run_period_start: text(filters.dateRange?.start),
				payroll_run_period_end: text(filters.dateRange?.end),
				lines: jsonWithoutStorageReferences(inclusion.lines),
				state: inclusion.state,
				included_at: instantText(inclusion.includedAt),
				ended_at: instantText(inclusion.endedAt),
				ended_by: userName(inclusion.endedByUserId),
			})),
		),
		tablePart(
			"project_attribution_exceptions",
			[
				"project",
				"valid_from",
				"valid_to",
				// Withheld: the expense administrators' internal notes.
				...(withheld ? ["reason", "evidence"] : []),
				"authorized_by",
				"authorized_at",
			],
			exceptions.map((exception) => ({
				project: projectName(exception.projectId),
				valid_from: exception.validFrom,
				valid_to: exception.validTo,
				...(withheld ? { reason: exception.reason, evidence: exception.evidence } : {}),
				authorized_by:
					userName(exception.authorizedByUserId) ?? employeeName(exception.authorizedByEmployeeId),
				authorized_at: instantText(exception.authorizedAt),
			})),
		),
	];

	return { category: CATEGORY, parts, files };
}
