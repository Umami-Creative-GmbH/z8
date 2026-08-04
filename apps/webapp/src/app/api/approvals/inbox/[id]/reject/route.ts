/**
 * Reject API
 *
 * POST /api/approvals/inbox/[id]/reject - Reject a single approval
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import {
	type ApprovalDecisionDiagnosticStage,
	buildApprovalDecisionFailureLog,
} from "@/lib/approvals/inbox/decision-diagnostics";
import {
	canAttemptApprovalInboxDecisionTarget,
	loadApprovalInboxDecisionTarget,
	type PersistedApprovalRequestForDecision,
	rejectApprovalInboxItem,
} from "@/lib/approvals/inbox/decision-service";
import { isSupportedInboxType } from "@/lib/approvals/inbox/source-adapters";
import { isEligibleManagerForApprovalRequest } from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	canAccessApprovalInbox,
	ForbiddenError,
	toHttpError,
} from "@/lib/authorization";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("RejectAPI");

function toApprovalErrorResponse(error: unknown) {
	if (error instanceof ConflictError) {
		return NextResponse.json({ error: error.message }, { status: 409 });
	}

	if (error instanceof AuthorizationError) {
		return NextResponse.json({ error: error.message }, { status: 403 });
	}

	if (error instanceof NotFoundError) {
		return NextResponse.json({ error: error.message }, { status: 404 });
	}

	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}

	return null;
}

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	let approvalId: string | null = null;
	let decisionStage: ApprovalDecisionDiagnosticStage = "route";
	let decisionTarget: PersistedApprovalRequestForDecision | null = null;
	try {
		const { id } = await params;
		approvalId = id;

		// Authenticate
		decisionStage = "authentication";
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrganizationId = session.session?.activeOrganizationId;
		if (!activeOrganizationId) {
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		decisionStage = "authorization";
		const ability = await getAbility();
		if (!ability) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		// Get current employee scoped to the active organization
		decisionStage = "actor_lookup";
		const currentEmployee = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrganizationId),
				eq(employee.isActive, true),
			),
		});

		if (!currentEmployee) {
			return NextResponse.json(
				{ error: "Employee not found" },
				{ status: 404 },
			);
		}

		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		if (!canAccessApprovalInbox(ability, currentEmployee)) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		decisionStage = "target_lookup";
		const approvalReq = await loadApprovalInboxDecisionTarget({
			approvalId: id,
			organizationId: currentEmployee.organizationId,
		});
		decisionTarget = approvalReq;

		if (!approvalReq) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		if (approvalReq.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		decisionStage = "target_authorization";
		const isAssignedApprover = approvalReq.approverId === currentEmployee.id;
		const isEligibleManager = isAssignedApprover
			? true
			: approvalReq.targetType === "compatibility_request"
				? await isEligibleManagerForApprovalRequest({
						db,
						approvalRequestId: approvalReq.id,
						managerEmployeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
					})
				: false;

		if (!isAssignedApprover && !isEligibleManager && !canManageApprovals) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		if (!isSupportedInboxType(approvalReq.entityType)) {
			return NextResponse.json(
				{ error: "Unsupported approval type" },
				{ status: 400 },
			);
		}
		if (!canAttemptApprovalInboxDecisionTarget(approvalReq)) {
			return NextResponse.json(
				{ error: `Request is already ${approvalReq.status}` },
				{ status: 409 },
			);
		}

		// Parse body only after authentication and approval authorization.
		const body = await request.json().catch(() => ({}));
		const reason = typeof body.reason === "string" ? body.reason : "";

		if (!reason || reason.trim().length === 0) {
			return NextResponse.json(
				{ error: "Rejection reason is required" },
				{ status: 400 },
			);
		}

		decisionStage = "decision";
		const result = await rejectApprovalInboxItem({
			approvalId: id,
			actorEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			reason,
			includeAllApprovers: canManageApprovals || undefined,
			eligibleApprovalScopes:
				!canManageApprovals && isEligibleManager
					? [
							{
								requesterEmployeeId: approvalReq.requesterEmployeeId,
								eligibleApproverIds: [
									approvalReq.approverId,
									currentEmployee.id,
								],
							},
						]
					: [],
		});

		logger.info(
			{
				approvalId: id,
				entityType: approvalReq.entityType,
				entityId: approvalReq.entityId,
				approverId: currentEmployee.id,
				reason,
			},
			"Approval rejected via unified inbox",
		);

		return NextResponse.json({ success: true, result });
	} catch (error) {
		const errorResponse = toApprovalErrorResponse(error);
		if (errorResponse) {
			return errorResponse;
		}

		logger.error(
			buildApprovalDecisionFailureLog({
				error,
				action: "reject",
				approvalId,
				decisionStage,
				target: decisionTarget,
			}),
			"Failed to reject",
		);
		return NextResponse.json(
			{ success: false, error: "Failed to reject request" },
			{ status: 500 },
		);
	}
}
