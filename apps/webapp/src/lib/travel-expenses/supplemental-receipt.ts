import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	travelExpenseReceiptUpload,
	travelExpenseReport,
	travelExpenseReportReceipt,
	travelExpenseReportSupplementalReceipt,
} from "@/db/schema";
import { loadTravelExpenseReportSubmittedRevision } from "@/lib/approvals/evidence/travel-expense-report-store";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import { getAuthContext } from "@/lib/auth-helpers";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "./attachment-validation";
import { loadFinanceActor } from "./finance-access";
import { mergeOfficerScopes } from "./officer-scope";
import { isSourceInOfficerScope } from "./officer-scope-read";
import type { StoredReceiptObject } from "./receipt-upload";
import type { StagedReportReceiptUpload } from "./report-receipt-upload";

type Database = typeof db;
type Executor =
	| Database
	| Parameters<Parameters<Database["transaction"]>[0]>[0];
type Report = typeof travelExpenseReport.$inferSelect;

/** Current review rights, or approved handling capability within the captured officer scope. */
export async function canSupplyReportReceipt(
	report: Report,
	cycle: number,
	options: { database?: Executor; lockAuthority?: boolean } = {},
): Promise<boolean> {
	if (
		(report.status !== "submitted" && report.status !== "approved") ||
		report.submissionCount !== cycle
	)
		return false;
	const actor = await getAuthContext();
	if (
		!actor?.employee ||
		actor.employee.organizationId !== report.organizationId
	)
		return false;
	if (report.status === "approved") {
		const database = options.database ?? db;
		const finance = await loadFinanceActor({
			database,
			lockGrant: options.lockAuthority,
		});
		if (!finance || finance.organizationId !== report.organizationId)
			return false;
		return isSourceInOfficerScope(
			database,
			mergeOfficerScopes(finance.scopes.export, finance.scopes.settle),
			{
				organizationId: report.organizationId,
				source: { type: "report", id: report.id },
				employeeId: report.employeeId,
			},
		);
	}
	const revision = await loadTravelExpenseReportSubmittedRevision(db, {
		organizationId: report.organizationId,
		reportId: report.id,
		submissionCycle: cycle,
	});
	if (!revision) return false;
	const authorized = await loadAuthorizedApprovalDetail({
		userId: actor.user.id,
		organizationId: report.organizationId,
		approvalId: revision.legacy.approvalRequestId,
		kind: "compatibility",
	});
	return (
		authorized.status === "found" &&
		authorized.detail.item.status === "pending" &&
		authorized.detail.item.entityId === report.id &&
		authorized.detail.item.type === "travel_expense_report" &&
		(authorized.detail.actions.canApprove ||
			authorized.detail.actions.canReject)
	);
}

/** Report-scoped immutable documents for a specific submission. */
export async function listSupplementalReceipts(
	database: Executor,
	scope: { organizationId: string; reportId: string; submissionCycle: number },
) {
	return database
		.select()
		.from(travelExpenseReportSupplementalReceipt)
		.where(
			and(
				eq(
					travelExpenseReportSupplementalReceipt.organizationId,
					scope.organizationId,
				),
				eq(travelExpenseReportSupplementalReceipt.reportId, scope.reportId),
				eq(
					travelExpenseReportSupplementalReceipt.submissionCycle,
					scope.submissionCycle,
				),
			),
		);
}

export async function missingSubmittedReceiptEligible(
	database: Executor,
	input: {
		organizationId: string;
		reportId: string;
		itemId: string;
		submissionCycle: number;
	},
	report?: Report,
	options: { lockAuthority?: boolean } = {},
) {
	const current =
		report ??
		(await database.query.travelExpenseReport.findFirst({
			where: and(
				eq(travelExpenseReport.organizationId, input.organizationId),
				eq(travelExpenseReport.id, input.reportId),
			),
		}));
	if (
		!current ||
		!(await canSupplyReportReceipt(current, input.submissionCycle, {
			database,
			lockAuthority: options.lockAuthority,
		}))
	)
		return false;
	const revision = await loadTravelExpenseReportSubmittedRevision(database, {
		organizationId: input.organizationId,
		reportId: input.reportId,
		submissionCycle: input.submissionCycle,
	});
	const item = revision?.facts.items.find(
		(candidate) => candidate.itemId === input.itemId,
	);
	if (item?.type !== "receipt" || item.receipts.length > 0) return false;
	const existing = await database
		.select({ id: travelExpenseReportReceipt.id })
		.from(travelExpenseReportReceipt)
		.where(
			and(
				eq(travelExpenseReportReceipt.organizationId, input.organizationId),
				eq(travelExpenseReportReceipt.reportId, input.reportId),
				eq(travelExpenseReportReceipt.itemId, input.itemId),
			),
		)
		.limit(1);
	return (
		existing.length === 0 &&
		!(await listSupplementalReceipts(database, input)).some(
			(receipt) => receipt.itemId === input.itemId,
		)
	);
}

/** Finalization serializes on the same report row as submission and decisions. */
export async function finalizeSupplementalReceipt(
	database: Database,
	input: StagedReportReceiptUpload & {
		submissionCycle: number;
		stored: StoredReceiptObject;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		checksumSha256: string;
	},
) {
	return database.transaction(async (tx) => {
		const [report] = await tx
			.select()
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, input.reportId),
					eq(travelExpenseReport.organizationId, input.organizationId),
				),
			)
			.for("update");
		if (
			!report ||
			!(await missingSubmittedReceiptEligible(tx, input, report, {
				lockAuthority: true,
			}))
		)
			return { kind: "conflict" } as const;
		const actor = await getAuthContext();
		if (
			!actor?.employee ||
			actor.employee.id !== input.uploadedBy ||
			actor.user.id !== input.userId
		)
			return { kind: "conflict" } as const;
		const released = await tx
			.delete(travelExpenseReceiptUpload)
			.where(
				and(
					eq(travelExpenseReceiptUpload.id, input.receiptId),
					eq(travelExpenseReceiptUpload.organizationId, input.organizationId),
					eq(travelExpenseReceiptUpload.reportId, input.reportId),
					eq(travelExpenseReceiptUpload.itemId, input.itemId),
					eq(travelExpenseReceiptUpload.storageKey, input.storageKey),
					eq(travelExpenseReceiptUpload.status, "pending"),
				),
			)
			.returning({ id: travelExpenseReceiptUpload.id });
		if (released.length !== 1)
			throw new Error("Receipt upload is no longer pending");
		const [supplier] = await tx
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, actor.user.id));
		if (!supplier) throw new Error("Receipt supplier not found");
		const receipt = {
			receiptId: input.receiptId,
			itemId: input.itemId,
			object: {
				provider: TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
				bucket: input.stored.bucket,
				key: input.storageKey,
				versionId: input.stored.versionId,
			},
			checksumSha256: input.checksumSha256,
			sizeBytes: input.sizeBytes,
			mimeType: input.mimeType,
		};
		const [saved] = await tx
			.insert(travelExpenseReportSupplementalReceipt)
			.values({
				id: input.receiptId,
				organizationId: input.organizationId,
				reportId: input.reportId,
				itemId: input.itemId,
				submissionCycle: input.submissionCycle,
				receipt,
				fileName: input.fileName,
				uploadedBy: input.uploadedBy,
				uploadedByName: supplier.name,
				createdAt: dateFromInstant(systemClock.nowInstant()),
			})
			.returning();
		if (!saved) throw new Error("Failed to attach supplemental receipt");
		return {
			kind: "attached",
			receipt: {
				id: saved.id,
				fileName: saved.fileName,
				mimeType: input.mimeType,
				sizeBytes: input.sizeBytes,
				createdAt: saved.createdAt.toISOString(),
			},
		} as const;
	});
}
