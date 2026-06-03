/**
 * Bulk Reject API
 *
 * POST /api/approvals/inbox/bulk-reject - Reject multiple approvals
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { bulkRejectApprovalInboxItems } from "@/lib/approvals/inbox/decision-service";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("BulkRejectAPI");

const MAX_BULK_REJECT = 50;

export async function POST(request: NextRequest) {
	try {
		const body = await request.json().catch(() => ({}));
		const approvalIds = Array.isArray(body.approvalIds)
			? body.approvalIds.filter(
					(id: unknown): id is string => typeof id === "string" && id.length > 0,
				)
			: [];
		const reason = typeof body.reason === "string" ? body.reason : "";

		if (!Array.isArray(approvalIds) || approvalIds.length === 0) {
			return NextResponse.json({ error: "approvalIds array is required" }, { status: 400 });
		}

		if (approvalIds.length > MAX_BULK_REJECT) {
			return NextResponse.json(
				{ error: `Maximum ${MAX_BULK_REJECT} approvals at once` },
				{ status: 400 },
			);
		}

		if (!reason || reason.trim().length === 0) {
			return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
		}

		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrganizationId = session.session?.activeOrganizationId;
		if (!activeOrganizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const ability = await getAbility();
		if (!ability) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}
		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		const canApproveApprovals = ability.cannot("approve", "Approval") === false;
		if (!canApproveApprovals && !canManageApprovals) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const currentEmployee = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrganizationId),
				eq(employee.isActive, true),
			),
		});

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		const eligibleApprovalScopes = canManageApprovals
			? []
			: await getEligibleApprovalScopesForManager({
					db,
					managerEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				});

		const result = await bulkRejectApprovalInboxItems({
			approvalIds,
			actorEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			reason,
			includeAllApprovers: canManageApprovals || undefined,
			eligibleApprovalScopes,
		});

		logger.info(
			{
				requested: approvalIds.length,
				succeeded: result.succeeded.length,
				failed: result.failed.length,
				approverId: currentEmployee.id,
			},
			"Bulk reject completed",
		);

		return NextResponse.json(result);
	} catch (error) {
		logger.error({ error }, "Failed to bulk reject");
		return NextResponse.json({ error: "Failed to process bulk rejection" }, { status: 500 });
	}
}
