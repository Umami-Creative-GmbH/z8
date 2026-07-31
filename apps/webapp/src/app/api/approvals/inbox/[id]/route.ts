/**
 * Approval Detail API
 *
 * GET /api/approvals/inbox/[id] - Get approval detail for slide-over panel
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { ApprovalInboxBadRequestError } from "@/lib/approvals/inbox/current-actor";
import { getApprovalInboxDetail } from "@/lib/approvals/inbox/read-service";
import { isSupportedInboxType } from "@/lib/approvals/inbox/source-adapters";
import {
	getEligibleApprovalScopesForManager,
	isEligibleManagerForApprovalRequest,
} from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	canAccessApprovalInbox,
	ForbiddenError,
	toHttpError,
} from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApprovalDetailAPI");

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;

		// Authenticate
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

		// Get current employee for the active organization
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

		// Get the approval request
		const request = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, id),
				eq(approvalRequest.organizationId, currentEmployee.organizationId),
			),
		});

		if (request && request.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		// Check CASL permissions and approval scope after org ownership is verified.
		const ability = await getAbility();
		if (!ability) {
			const error = new ForbiddenError("read", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		if (!canAccessApprovalInbox(ability, currentEmployee)) {
			const error = new ForbiddenError("read", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}
		if (!request) {
			const eligibleApprovalScopes = canManageApprovals
				? []
				: await getEligibleApprovalScopesForManager({
						db,
						managerEmployeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
					});
			const detail = await getApprovalInboxDetail({
				approvalId: id,
				organizationId: currentEmployee.organizationId,
				approverId: currentEmployee.id,
				includeAllApprovers: canManageApprovals || undefined,
				eligibleApprovalScopes,
			});
			return NextResponse.json(detail);
		}

		const isAssignedApprover = request.approverId === currentEmployee.id;
		const isEligibleManager = isAssignedApprover
			? true
			: await isEligibleManagerForApprovalRequest({
					db,
					approvalRequestId: request.id,
					managerEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				});

		if (!isAssignedApprover && !isEligibleManager && !canManageApprovals) {
			const error = new ForbiddenError("read", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		if (!isSupportedInboxType(request.entityType)) {
			return NextResponse.json(
				{ error: "Unsupported approval type" },
				{ status: 400 },
			);
		}

		const detail = await getApprovalInboxDetail({
			approvalId: id,
			organizationId: currentEmployee.organizationId,
		});

		return NextResponse.json(detail);
	} catch (error) {
		if (error instanceof ApprovalInboxBadRequestError) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}
		logger.error({ error }, "Failed to fetch approval detail");
		return NextResponse.json(
			{ error: "Failed to fetch approval detail" },
			{ status: 500 },
		);
	}
}
