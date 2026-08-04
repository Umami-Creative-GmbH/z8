/**
 * Approve API
 *
 * POST /api/approvals/inbox/[id]/approve - Approve a single approval
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
	approveApprovalInboxItem,
	canAttemptApprovalInboxDecisionTarget,
	loadApprovalInboxDecisionTarget,
	type PersistedApprovalRequestForDecision,
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

const logger = createLogger("ApproveAPI");

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
	_request: NextRequest,
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

		// Get active organization from session
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

		// Get current employee for the active organization
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
		const request = await loadApprovalInboxDecisionTarget({
			approvalId: id,
			organizationId: currentEmployee.organizationId,
		});
		decisionTarget = request;

		if (!request) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		if (request.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		decisionStage = "target_authorization";
		const isAssignedApprover = request.approverId === currentEmployee.id;
		const isEligibleManager = isAssignedApprover
			? true
			: request.targetType === "compatibility_request"
				? await isEligibleManagerForApprovalRequest({
						db,
						approvalRequestId: request.id,
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

		if (!isSupportedInboxType(request.entityType)) {
			return NextResponse.json(
				{ error: "Unsupported approval type" },
				{ status: 400 },
			);
		}
		if (!canAttemptApprovalInboxDecisionTarget(request)) {
			return NextResponse.json(
				{ error: `Request is already ${request.status}` },
				{ status: 409 },
			);
		}

		decisionStage = "decision";
		const result = await approveApprovalInboxItem({
			approvalId: id,
			actorEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			includeAllApprovers: canManageApprovals || undefined,
			eligibleApprovalScopes:
				!canManageApprovals && isEligibleManager
					? [
							{
								requesterEmployeeId: request.requesterEmployeeId,
								eligibleApproverIds: [request.approverId, currentEmployee.id],
							},
						]
					: [],
		});

		logger.info(
			{
				approvalId: id,
				entityType: request.entityType,
				entityId: request.entityId,
				approverId: currentEmployee.id,
			},
			"Approval approved via unified inbox",
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
				action: "approve",
				approvalId,
				decisionStage,
				target: decisionTarget,
			}),
			"Failed to approve",
		);
		return NextResponse.json(
			{ success: false, error: "Failed to approve request" },
			{ status: 500 },
		);
	}
}
