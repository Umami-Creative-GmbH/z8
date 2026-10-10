import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import {
	getEligibleApprovalScopesForManager,
	isEligibleManagerForApprovalRequest,
} from "@/lib/approvals/policies/manager-eligibility-db";
import {
	type DeputyDetailAccess,
	loadDeputyDetailAccess,
	loadInboxCovers,
} from "@/lib/approvals/deputy/deputy-decision-store";
import { getAbility } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import { systemClock } from "@/lib/datetime/temporal-core";
import { markDecidedEarlierStageDetail } from "./covering-marks";
import { ApprovalInboxBadRequestError } from "./current-actor";
import { markOwnRequestDetail } from "./own-request";
import { getApprovalInboxDetail } from "./read-service";
import { isSupportedInboxType } from "./source-adapters";
import type { ApprovalInboxDetailResult } from "./types";

export type AuthorizedApprovalDetailResult =
	| { status: "found"; detail: ApprovalInboxDetailResult }
	| { status: "no_employee" }
	| { status: "forbidden" }
	| { status: "not_found" }
	| { status: "unsupported_type" };

/**
 * The inbox's single read authorization for one approval: current active
 * employee, approval-inbox access, and exact assignment, eligible-manager or
 * explicit manage permission. `kind` pins the reference type so a canonical
 * assignment and a compatibility request never stand in for each other.
 * Infrastructure failures throw.
 */
export async function loadAuthorizedApprovalDetail(input: {
	userId: string;
	/**
	 * Must be the session's active organization: permissions come from
	 * getAbility(), which is built for that organization only.
	 */
	organizationId: string;
	approvalId: string;
	kind?: "compatibility" | "canonical";
}): Promise<AuthorizedApprovalDetailResult> {
	const currentEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, input.userId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!currentEmployee) return { status: "no_employee" };

	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, currentEmployee.organizationId),
		),
	});
	if (request && request.organizationId !== currentEmployee.organizationId) {
		return { status: "not_found" };
	}

	// Check CASL permissions and approval scope after org ownership is verified.
	const ability = await getAbility();
	if (!ability || !canAccessApprovalInbox(ability, currentEmployee)) {
		return { status: "forbidden" };
	}
	const canManageApprovals = ability.cannot("manage", "Approval") === false;

	try {
		if (!request) {
			if (input.kind === "compatibility") return { status: "not_found" };
			const eligibleApprovalScopes = canManageApprovals
				? []
				: await getEligibleApprovalScopesForManager({
						db,
						managerEmployeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
					});
			const detail = await getApprovalInboxDetail({
				approvalId: input.approvalId,
				organizationId: currentEmployee.organizationId,
				approverId: currentEmployee.id,
				includeAllApprovers: canManageApprovals || undefined,
				eligibleApprovalScopes,
				// A canonical assignment of an absent approver this employee covers for (#1016).
				covering: await loadInboxCovers(db, {
					organizationId: currentEmployee.organizationId,
					deputyEmployeeId: currentEmployee.id,
					at: systemClock.nowInstant(),
				}),
			});
			return { status: "found", detail: markOwnRequestDetail(detail, currentEmployee.id) };
		}
		if (input.kind === "canonical") return { status: "not_found" };

		const isAssignedApprover = request.approverId === currentEmployee.id;
		const isEligibleManager = isAssignedApprover
			? true
			: await isEligibleManagerForApprovalRequest({
					db,
					approvalRequestId: request.id,
					managerEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				});
		// The absent approver's covering deputy sees the same detail (#1016); the
		// deputy rule follows the request's current approver.
		const deputyAccess = isAssignedApprover ? null : await loadDeputyDetailAccess(db, {
			organizationId: currentEmployee.organizationId,
			approvalRequestId: request.id,
			entityType: request.entityType,
			status: request.status,
			approverEmployeeId: request.approverId,
			deputyEmployeeId: currentEmployee.id,
			at: systemClock.nowInstant(),
		});
		if (!isAssignedApprover && !isEligibleManager && !canManageApprovals && !deputyAccess) {
			return { status: "forbidden" };
		}
		if (!isSupportedInboxType(request.entityType)) {
			return { status: "unsupported_type" };
		}

		const detail = markOwnRequestDetail(
			await getApprovalInboxDetail({
				approvalId: input.approvalId,
				organizationId: currentEmployee.organizationId,
			}),
			currentEmployee.id,
		);
		return { status: "found", detail: withDeputyMarks(detail, deputyAccess) };
	} catch (error) {
		if (error instanceof ApprovalInboxBadRequestError) {
			return { status: "not_found" };
		}
		throw error;
	}
}

function withDeputyMarks(
	detail: ApprovalInboxDetailResult,
	access: DeputyDetailAccess | null,
): ApprovalInboxDetailResult {
	if (access?.kind !== "covering" || detail.item.status !== "pending") return detail;
	const marked = { ...detail, item: { ...detail.item, coveringFor: access.cover } };
	return access.decidedEarlierStage ? markDecidedEarlierStageDetail(marked) : marked;
}
