import "server-only";
import "@/lib/approvals/init";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	travelExpenseAttachment,
	travelExpenseClaim,
	travelExpenseDecisionLog,
} from "@/db/schema";
import {
	listLegacyDecisionEvidence,
	loadLegacyTravelExpenseSubmittedRevision,
} from "@/lib/approvals/evidence/store";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { loadFinanceActor } from "./finance-access";

/** Reads share the inbox's existing review scope; reading never creates a binding or changes authority. */
export async function loadAuthorizedTravelExpenseClaim(claimId: string) {
	const actor = await getAuthContext();
	if (!actor?.employee) return { status: "unauthorized" } as const;
	if (!z.uuid().safeParse(claimId).success)
		return { status: "not_found" } as const;
	const organizationId = actor.employee.organizationId;
	const claim = await db.query.travelExpenseClaim.findFirst({
		where: and(
			eq(travelExpenseClaim.id, claimId),
			eq(travelExpenseClaim.organizationId, organizationId),
		),
	});
	if (!claim) return { status: "not_found" } as const;
	if (claim.employeeId !== actor.employee.id) {
		const requests = await db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
				eq(approvalRequest.entityId, claim.id),
			),
		});
		let authorized = false;
		for (const request of requests) {
			const review = await loadAuthorizedApprovalDetail({
				userId: actor.user.id,
				organizationId,
				approvalId: request.id,
				kind: "compatibility",
			});
			if (
				review.status === "found" &&
				review.detail.item.entityId === claim.id &&
				review.detail.item.type === "travel_expense_claim"
			) {
				authorized = true;
				break;
			}
		}
		// Finance (#612) reads approved claims; reviewing never grants this.
		if (!authorized && claim.status === "approved") {
			authorized = (await loadFinanceActor())?.canRead === true;
		}
		if (!authorized) return { status: "not_found" } as const;
	}
	return { status: "found", claim } as const;
}
export async function loadTravelExpenseClaimDetail(
	claim: typeof travelExpenseClaim.$inferSelect,
) {
	const [attachments, decisions, revision] = await Promise.all([
		db.query.travelExpenseAttachment.findMany({
			where: and(
				eq(travelExpenseAttachment.organizationId, claim.organizationId),
				eq(travelExpenseAttachment.claimId, claim.id),
			),
			columns: {
				id: true,
				fileName: true,
				mimeType: true,
				sizeBytes: true,
				checksumSha256: true,
				storageVersionId: true,
			},
			orderBy: [
				asc(travelExpenseAttachment.createdAt),
				asc(travelExpenseAttachment.id),
			],
		}),
		db
			.select({
				id: travelExpenseDecisionLog.id,
				claimId: travelExpenseDecisionLog.claimId,
				organizationId: travelExpenseDecisionLog.organizationId,
				actorEmployeeId: travelExpenseDecisionLog.actorEmployeeId,
				approverId: travelExpenseDecisionLog.approverId,
				action: travelExpenseDecisionLog.action,
				reason: travelExpenseDecisionLog.reason,
				comment: travelExpenseDecisionLog.comment,
				createdAt: travelExpenseDecisionLog.createdAt,
				actorName: user.name,
			})
			.from(travelExpenseDecisionLog)
			.leftJoin(
				employee,
				and(
					eq(employee.id, travelExpenseDecisionLog.actorEmployeeId),
					eq(employee.organizationId, claim.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(travelExpenseDecisionLog.organizationId, claim.organizationId),
					eq(travelExpenseDecisionLog.claimId, claim.id),
				),
			)
			.orderBy(
				asc(travelExpenseDecisionLog.createdAt),
				asc(travelExpenseDecisionLog.id),
			),
		loadLegacyTravelExpenseSubmittedRevision(db, {
			organizationId: claim.organizationId,
			claimId: claim.id,
		}),
	]);
	const evidence = revision
		? await listLegacyDecisionEvidence(db, {
				organizationId: claim.organizationId,
				submittedRevisionId: revision.id,
			})
		: [];
	// Terminal decisions already have legacy log rows; only intermediate chain
	// decisions need supplementing from their original evidence.
	const intermediateDecisions = evidence
		.filter((decision) => decision.requestOutcome === "pending")
		.map((decision) => ({
			id: decision.id,
			action: "approval_recorded" as const,
			createdAt: instantToCanonicalString(decision.decidedAt),
			actorName: decision.labels.actorName,
			reason: null,
			comment: null,
		}));
	return { claim, attachments, decisions, intermediateDecisions };
}
