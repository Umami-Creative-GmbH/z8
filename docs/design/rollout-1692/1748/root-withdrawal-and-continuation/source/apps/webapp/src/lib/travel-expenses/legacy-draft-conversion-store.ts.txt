import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import type { db as appDb } from "@/db";
import {
	approvalRequest,
	approvalSubmittedRevision,
	project,
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseLegacyDraftConversion,
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportPerDiem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "./attachment-validation";
import { loadOrganizationReimbursementCurrency } from "./conversion-read";
import {
	type LegacyConversionFlag,
	type LegacyDraftClaim,
	type LegacyDraftSnapshot,
	type LegacyReceiptIdentity,
	legacyAttachmentNeedsRead,
	legacyReceiptIdentity,
	type ObservedReceiptContent,
	planLegacyDraftConversion,
} from "./legacy-draft-conversion";
import { findLegacyDraftConversion } from "./legacy-draft-conversion-read";
import type { ReportOwner } from "./report-store";

/**
 * Legacy draft conversion (#616), the store. Explicit and per draft: the owner
 * converts one of their own legacy claim drafts, in one transaction that holds
 * the claim row lock (the lock legacy receipt finalization takes), so an upload
 * either attaches before the conversion reads the attachments or is refused
 * afterwards and left to the receipt cleanup. The conversion record is unique
 * per claim, so retries and concurrent attempts return the same report. Only
 * drafts without any approval history convert; submitted and decided claims,
 * their requests, assignments, revisions and evidence are never touched.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

/** Reads one stored receipt object (`readPrivateObject` in production). */
export type ReadReceiptObject = (input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}) => Promise<Buffer | Uint8Array>;

export type LegacyReceiptRefusal = Extract<LegacyReceiptIdentity, { ok: false }>["reason"];

export type ConvertLegacyDraftResult =
	/** `replayed`: the draft had already been converted; nothing new was written. */
	| { kind: "converted"; reportId: string; replayed: boolean }
	| { kind: "not_found" }
	/** The claim was submitted or decided; it keeps its original approval history. */
	| { kind: "not_draft" }
	/** A draft that still carries approval rows of an earlier submission is never rewritten. */
	| { kind: "has_approval_history" }
	/** A receipt's content identity cannot be established; nothing was converted. */
	| {
			kind: "receipt_unavailable";
			attachments: { attachmentId: string; fileName: string; reason: LegacyReceiptRefusal }[];
	  };

export interface ConvertLegacyDraftOptions {
	readObject: ReadReceiptObject;
	/** The zone of a per diem trip whose legacy draft recorded none (the employee's effective zone). */
	defaultTimeZone: string;
}

type AttachmentRow = typeof travelExpenseAttachment.$inferSelect;
type ClaimRow = typeof travelExpenseClaim.$inferSelect;

function ownedClaim(owner: ReportOwner, claimId: string) {
	return and(
		eq(travelExpenseClaim.id, claimId),
		eq(travelExpenseClaim.organizationId, owner.organizationId),
		eq(travelExpenseClaim.employeeId, owner.employeeId),
	);
}

function loadAttachments(database: Reader, owner: ReportOwner, claimId: string) {
	return database
		.select()
		.from(travelExpenseAttachment)
		.where(
			and(
				eq(travelExpenseAttachment.claimId, claimId),
				eq(travelExpenseAttachment.organizationId, owner.organizationId),
			),
		)
		.orderBy(asc(travelExpenseAttachment.createdAt), asc(travelExpenseAttachment.id));
}

/** Identity of the attachment's exact stored object version, for matching reads to rows. */
function objectKey(attachment: Pick<AttachmentRow, "id" | "storageKey" | "storageVersionId">) {
	return `${attachment.id}:${attachment.storageKey}:${attachment.storageVersionId ?? ""}`;
}

/** Reads, outside any transaction, the stored bytes of attachments that recorded no full identity. */
async function observeHistoricalReceipts(
	attachments: AttachmentRow[],
	owner: ReportOwner,
	readObject: ReadReceiptObject,
): Promise<Map<string, ObservedReceiptContent | null>> {
	const observed = new Map<string, ObservedReceiptContent | null>();
	for (const attachment of attachments) {
		if (!legacyAttachmentNeedsRead(attachment)) continue;
		try {
			const bytes = Buffer.from(
				// One object at a time on purpose: it keeps storage load bounded.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await readObject({
					organizationId: owner.organizationId,
					key: attachment.storageKey,
					bucket: attachment.storageBucket,
					versionId: attachment.storageVersionId,
				}),
			);
			observed.set(objectKey(attachment), {
				sizeBytes: bytes.byteLength,
				checksumSha256: createHash("sha256").update(bytes).digest("hex"),
				mimeType: (await fileTypeFromBuffer(bytes))?.mime ?? null,
			});
		} catch {
			observed.set(objectKey(attachment), null);
		}
	}
	return observed;
}

function toLegacyDraftClaim(claim: ClaimRow): LegacyDraftClaim {
	return {
		id: claim.id,
		type: claim.type,
		tripStartDate: claim.tripStartDate,
		tripEndDate: claim.tripEndDate,
		tripDateTimeZone: claim.tripDateTimeZone,
		destinationCity: claim.destinationCity,
		destinationCountry: claim.destinationCountry,
		projectId: claim.projectId,
		originalAmount: claim.originalAmount,
		originalCurrency: claim.originalCurrency,
		calculatedAmount: claim.calculatedAmount,
		calculatedCurrency: claim.calculatedCurrency,
		notes: claim.notes,
	};
}

/** Approval rows of any earlier submission of the claim, under any authority. */
export async function hasApprovalHistory(tx: Transaction, organizationId: string, claimId: string) {
	const [request] = await tx
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
				eq(approvalRequest.entityId, claimId),
			),
		)
		.limit(1);
	if (request) return true;
	const [revision] = await tx
		.select({ id: approvalSubmittedRevision.id })
		.from(approvalSubmittedRevision)
		.where(
			and(
				eq(approvalSubmittedRevision.organizationId, organizationId),
				eq(approvalSubmittedRevision.sourceType, "travel_expense_claim"),
				eq(approvalSubmittedRevision.sourceId, claimId),
			),
		)
		.limit(1);
	return Boolean(revision);
}

type ConversionAttempt = ConvertLegacyDraftResult | { kind: "attachments_changed" };

/**
 * Converts the owner's legacy draft `claimId` into a single-item draft report,
 * or returns the report it was already converted into.
 */
export async function convertLegacyDraft(
	database: Database,
	owner: ReportOwner,
	input: { claimId: string },
	options: ConvertLegacyDraftOptions,
	now: Instant = systemClock.nowInstant(),
): Promise<ConvertLegacyDraftResult> {
	// An attachment finalized between reading historical bytes and taking the
	// lock is re-read; current uploads always record their identity, so this
	// settles after one more round.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = await attemptConversion(database, owner, input.claimId, options, now);
		if (result.kind !== "attachments_changed") return result;
	}
	throw new Error("Legacy draft attachments kept changing during conversion");
}

async function attemptConversion(
	database: Database,
	owner: ReportOwner,
	claimId: string,
	options: ConvertLegacyDraftOptions,
	now: Instant,
): Promise<ConversionAttempt> {
	const [claim] = await database
		.select({ id: travelExpenseClaim.id, status: travelExpenseClaim.status })
		.from(travelExpenseClaim)
		.where(ownedClaim(owner, claimId))
		.limit(1);
	if (!claim) return { kind: "not_found" };
	const existing = await findLegacyDraftConversion(database, {
		organizationId: owner.organizationId,
		claimId,
	});
	if (existing) return { kind: "converted", reportId: existing.reportId, replayed: true };
	if (claim.status !== "draft") return { kind: "not_draft" };
	const observed = await observeHistoricalReceipts(
		await loadAttachments(database, owner, claimId),
		owner,
		options.readObject,
	);

	const at = dateFromInstant(now);
	return database.transaction(async (tx): Promise<ConversionAttempt> => {
		const [locked] = await tx
			.select()
			.from(travelExpenseClaim)
			.where(ownedClaim(owner, claimId))
			.for("update");
		if (!locked) return { kind: "not_found" };
		const converted = await findLegacyDraftConversion(tx, {
			organizationId: owner.organizationId,
			claimId,
		});
		if (converted) return { kind: "converted", reportId: converted.reportId, replayed: true };
		if (locked.status !== "draft") return { kind: "not_draft" };
		if (await hasApprovalHistory(tx, owner.organizationId, claimId)) {
			return { kind: "has_approval_history" };
		}

		const attachments = await loadAttachments(tx, owner, claimId);
		const identities: { attachment: AttachmentRow; identity: LegacyReceiptIdentity }[] = [];
		for (const attachment of attachments) {
			const key = objectKey(attachment);
			if (legacyAttachmentNeedsRead(attachment) && !observed.has(key)) {
				return { kind: "attachments_changed" };
			}
			identities.push({
				attachment,
				identity: legacyReceiptIdentity(attachment, observed.get(key) ?? null),
			});
		}
		const refused = identities.flatMap(({ attachment, identity }) =>
			identity.ok
				? []
				: [{ attachmentId: attachment.id, fileName: attachment.fileName, reason: identity.reason }],
		);
		if (refused.length > 0) return { kind: "receipt_unavailable", attachments: refused };

		const legacy = toLegacyDraftClaim(locked);
		const projectInOrganization = legacy.projectId
			? (
					await tx
						.select({ id: project.id })
						.from(project)
						.where(
							and(
								eq(project.id, legacy.projectId),
								eq(project.organizationId, owner.organizationId),
							),
						)
						.limit(1)
				).length === 1
			: false;
		const currency = await loadOrganizationReimbursementCurrency(tx, owner.organizationId);
		const plan = planLegacyDraftConversion(legacy, {
			defaultTimeZone: options.defaultTimeZone,
			projectInOrganization,
			reimbursementCurrency: currency,
		});

		const [report] = await tx
			.insert(travelExpenseReport)
			.values({
				organizationId: owner.organizationId,
				employeeId: owner.employeeId,
				kind: plan.report.kind,
				status: "draft",
				reimbursementCurrency: currency,
				tripStartDate: plan.report.tripStartDate,
				tripEndDate: plan.report.tripEndDate,
				tripTimeZone: plan.report.tripTimeZone,
				tripDestinations: plan.report.tripDestinations,
				createdAt: at,
				createdBy: owner.userId,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning({ id: travelExpenseReport.id });
		if (!report) throw new Error("Failed to create the converted travel expense report");
		const [item] = await tx
			.insert(travelExpenseReportItem)
			.values({
				organizationId: owner.organizationId,
				reportId: report.id,
				type: plan.item.type,
				position: 0,
				expenseDate: plan.item.expenseDate,
				description: plan.item.description,
				originalAmount: plan.item.originalAmount,
				originalCurrency: plan.item.originalCurrency,
				paidBy: plan.item.paidBy,
				projectId: plan.item.projectId,
				projectInherits: plan.item.projectInherits,
				createdAt: at,
				updatedAt: at,
				updatedBy: owner.userId,
			})
			.returning({ id: travelExpenseReportItem.id });
		if (!item) throw new Error("Failed to create the converted travel expense report item");
		if (plan.perDiem) {
			await tx.insert(travelExpenseReportPerDiem).values({
				itemId: item.id,
				organizationId: owner.organizationId,
				reportId: report.id,
				startDate: plan.perDiem.startDate,
				startTimeZone: plan.perDiem.startTimeZone,
				endDate: plan.perDiem.endDate,
				endTimeZone: plan.perDiem.endTimeZone,
			});
		}

		// Each receipt names the legacy attachment's stored object: the cleanup
		// worker keeps an object while any attachment or receipt row names it.
		const snapshotAttachments: LegacyDraftSnapshot["attachments"] = [];
		const receipts: (typeof travelExpenseReportReceipt.$inferInsert)[] = [];
		for (const { attachment, identity } of identities) {
			if (!identity.ok) continue;
			const receiptId = randomUUID();
			receipts.push({
				id: receiptId,
				organizationId: owner.organizationId,
				reportId: report.id,
				itemId: item.id,
				storageProvider: TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
				storageBucket: attachment.storageBucket,
				storageKey: attachment.storageKey,
				storageVersionId: attachment.storageVersionId,
				fileName: attachment.fileName,
				mimeType: identity.mimeType,
				sizeBytes: identity.sizeBytes,
				checksumSha256: identity.checksumSha256,
				uploadedBy: attachment.uploadedBy,
				createdAt: attachment.createdAt,
			});
			snapshotAttachments.push({
				attachmentId: attachment.id,
				receiptId,
				fileName: attachment.fileName,
				storageKey: attachment.storageKey,
				checksumSha256: identity.checksumSha256,
			});
		}
		if (receipts.length > 0) await tx.insert(travelExpenseReportReceipt).values(receipts);

		const { id: _claimId, ...facts } = legacy;
		const snapshot: LegacyDraftSnapshot = {
			...facts,
			createdAt: locked.createdAt.toISOString(),
			attachments: snapshotAttachments,
		};
		const flags: LegacyConversionFlag[] = plan.flags;
		const [recorded] = await tx
			.insert(travelExpenseLegacyDraftConversion)
			.values({
				organizationId: owner.organizationId,
				employeeId: owner.employeeId,
				claimId,
				reportId: report.id,
				itemId: item.id,
				legacyFacts: snapshot,
				flags,
				convertedByUserId: owner.userId,
				convertedAt: at,
			})
			.onConflictDoNothing()
			.returning({ id: travelExpenseLegacyDraftConversion.id });
		// The claim lock makes this unreachable; a conflict must never leave a second report.
		if (!recorded) throw new Error("Legacy draft was converted concurrently");
		return { kind: "converted", reportId: report.id, replayed: false };
	});
}
