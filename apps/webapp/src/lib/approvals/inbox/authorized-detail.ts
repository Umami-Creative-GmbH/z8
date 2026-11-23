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
import { canAccessApprovalInbox, canOpenApprovalInbox } from "@/lib/authorization";
import { systemClock } from "@/lib/datetime/temporal-core";
import { resolveComplianceExceptionInboxScope } from "./compliance-exception-inbox";
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
	if (!ability || !canOpenApprovalInbox(ability, currentEmployee)) {
		return { status: "forbidden" };
	}
	const canManageApprovals = ability.cannot("manage", "Approval") === false;
	// Managing Compliance alone opens compliance exceptions, never an approval (#1977).
	const approverAccess = canAccessApprovalInbox(ability, currentEmployee);

	try {
		if (!request) {
			if (input.kind === "compatibility") return { status: "not_found" };
			const readsEligibility = approverAccess && !canManageApprovals;
			const eligibleApprovalScopes = readsEligibility
				? await getEligibleApprovalScopesForManager({
						db,
						managerEmployeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
					})
				: [];
			// A compliance exception opens within the viewer's own scope (#1977, ADR-0005), from
			// the eligibility read above when there was one.
			const complianceExceptionScope =
				input.kind === "canonical"
					? null
					: await resolveComplianceExceptionInboxScope({
							organizationId: currentEmployee.organizationId,
							employeeId: currentEmployee.id,
							canManageCompliance: ability.cannot("manage", "Compliance") === false,
							...(readsEligibility ? { eligibleApprovalScopes } : {}),
						});
			if (!approverAccess) {
				if (!complianceExceptionScope) return { status: "not_found" };
				const exception = await getApprovalInboxDetail({
					approvalId: input.approvalId,
					organizationId: currentEmployee.organizationId,
					complianceExceptionsOnly: true,
					complianceExceptionScope,
				});
				return { status: "found", detail: markOwnRequestDetail(exception, currentEmployee.id) };
			}
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
				...(complianceExceptionScope ? { complianceExceptionScope } : {}),
			});
			return { status: "found", detail: markOwnRequestDetail(detail, currentEmployee.id) };
		}
		if (input.kind === "canonical") return { status: "not_found" };
		// Managing Compliance alone opens no approval: one is answered as an unknown id is.
		if (!approverAccess) return { status: "not_found" };

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
		// deputy rule follows the request's current approver. Own rights win
		// (default 8): an approver, eligible manager or manager of approvals
		// decides as themselves, with no "Covering for" mark or four-eyes block.
		const deputyAccess =
			isAssignedApprover || isEligibleManager || canManageApprovals
				? null
				: await loadDeputyDetailAccess(db, {
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
