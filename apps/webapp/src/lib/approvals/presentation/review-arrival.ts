import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { createLogger } from "@/lib/logger";
import type { ApprovalReviewTarget } from "./review-navigation";

const logger = createLogger("ApprovalReviewArrival");

export type ApprovalReviewArrival =
	| { status: "ready"; item: ApprovalInboxItem }
	| {
			status: "switch_organization";
			organizationId: string;
			organizationName: string;
	  }
	| { status: "unavailable" };

/**
 * Authorizes arrival at an exact-item review link. Possessing the link is not
 * authority: approved membership in the target organization, that organization
 * being active, and the inbox's current read entitlement are all rechecked
 * before any approval fact loads. Missing, purged, reassigned and forbidden
 * items share one outcome so the link discloses nothing. Infrastructure
 * failures throw.
 */
export async function resolveApprovalReviewArrival(input: {
	userId: string;
	activeOrganizationId: string | null | undefined;
	target: ApprovalReviewTarget | null;
}): Promise<ApprovalReviewArrival> {
	const { target } = input;
	if (!target) return { status: "unavailable" };

	const membership = await db.query.member.findFirst({
		where: and(
			eq(member.userId, input.userId),
			eq(member.organizationId, target.organizationId),
			eq(member.status, "approved"),
		),
		columns: { id: true },
		with: { organization: { columns: { name: true } } },
	});
	if (!membership) return { status: "unavailable" };

	if (input.activeOrganizationId !== target.organizationId) {
		return {
			status: "switch_organization",
			organizationId: target.organizationId,
			organizationName: membership.organization.name,
		};
	}

	const { reference } = target;
	const result = await loadAuthorizedApprovalDetail({
		userId: input.userId,
		organizationId: target.organizationId,
		approvalId:
			reference.kind === "compatibility" ? reference.approvalRequestId : reference.assignmentId,
		kind: reference.kind,
	});
	if (result.status !== "found") {
		logger.info(
			{
				organizationId: target.organizationId,
				kind: reference.kind,
				reason: result.status,
			},
			"Approval review link unavailable",
		);
		return { status: "unavailable" };
	}
	return { status: "ready", item: result.detail.item };
}
