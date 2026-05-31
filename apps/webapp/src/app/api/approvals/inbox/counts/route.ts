/**
 * Approval Counts API
 *
 * GET /api/approvals/inbox/counts - Get pending approval counts per type
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getApprovalInboxCounts } from "@/lib/approvals/inbox/read-service";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApprovalCountsAPI");

export async function GET() {
	try {
		// Authenticate
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get active organization from session
		const activeOrganizationId = session.session?.activeOrganizationId;
		if (!activeOrganizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Check CASL permissions; eligible managers are scoped after employee lookup.
		const ability = await getAbility();
		if (!ability) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
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
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		const canApproveOrManage =
			ability.cannot("approve", "Approval") === false || canManageApprovals;

		if (!canApproveOrManage) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const eligibleApprovalScopes = canManageApprovals
			? []
			: await getEligibleApprovalScopesForManager({
					db,
					managerEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				});

		const counts = await getApprovalInboxCounts({
			approverId: currentEmployee.id,
			includeAllApprovers: canManageApprovals || undefined,
			organizationId: currentEmployee.organizationId,
			status: "pending",
			limit: 1,
			eligibleApprovalScopes,
		});

		return NextResponse.json(counts);
	} catch (error) {
		if (error instanceof Error && "digest" in error) {
			throw error;
		}

		logger.error({ error }, "Failed to fetch approval counts");
		return NextResponse.json({ error: "Failed to fetch approval counts" }, { status: 500 });
	}
}
