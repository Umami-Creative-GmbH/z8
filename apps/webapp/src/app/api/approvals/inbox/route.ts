/**
 * Unified Approval Inbox API
 *
 * GET /api/approvals/inbox - Get paginated approvals
 */

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import type { ApprovalPriority, ApprovalStatus } from "@/lib/approvals/domain/types";
import { getApprovalInboxList } from "@/lib/approvals/inbox/read-service";
import { isSupportedInboxType } from "@/lib/approvals/inbox/source-adapters";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApprovalInboxAPI");
const ISO_DATETIME_WITH_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;

export async function GET(request: NextRequest) {
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

		// Check CASL permissions; eligible managers are authorized after employee lookup.
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
		// Parse query parameters
		const { searchParams } = new URL(request.url);

		const status = parseStatus(searchParams.get("status"));
		const typesParam = searchParams.get("types");
		const types = typesParam
			? typesParam.split(",").filter(isSupportedInboxType)
			: undefined;
		const teamId = searchParams.get("teamId") || undefined;
		const search = searchParams.get("search") || undefined;
		const priority = parsePriority(searchParams.get("priority"));
		const minAgeDaysParam = searchParams.get("minAgeDays");
		const parsedMinAgeDays = minAgeDaysParam ? Number.parseInt(minAgeDaysParam, 10) : NaN;
		const minAgeDays = Number.isFinite(parsedMinAgeDays) ? parsedMinAgeDays : undefined;
		const cursor = searchParams.get("cursor") || undefined;
		const parsedLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
		const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

		// Date range filter
		let dateRange: { from: Date; to: Date } | undefined;
		const dateFrom = searchParams.get("dateFrom");
		const dateTo = searchParams.get("dateTo");
		if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
			return NextResponse.json(
				{ error: "Both dateFrom and dateTo are required" },
				{ status: 400 },
			);
		}
		if (dateFrom && dateTo) {
			const from = parseDateRangeInstant(dateFrom);
			const to = parseDateRangeInstant(dateTo);

			if (!from || !to || from > to) {
				return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
			}

			dateRange = { from: from.toJSDate(), to: to.toJSDate() };
		}

		const result = await getApprovalInboxList({
			approverId: currentEmployee.id,
			includeAllApprovers: canManageApprovals || undefined,
			organizationId: currentEmployee.organizationId,
			status,
			types,
			teamId,
			search,
			priority,
			minAgeDays,
			dateRange,
			cursor,
			limit,
			eligibleApprovalScopes,
		});

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof Error && "digest" in error) {
			throw error;
		}

		logger.error({ error }, "Failed to fetch approvals");
		return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
	}
}

function parseStatus(status: string | null): ApprovalStatus {
	return status === "approved" || status === "rejected" || status === "pending"
		? status
		: "pending";
}

function parsePriority(priority: string | null): ApprovalPriority | undefined {
	return priority === "urgent" || priority === "high" || priority === "normal" || priority === "low"
		? priority
		: undefined;
}

function parseDateRangeInstant(value: string): DateTime | null {
	if (!ISO_DATETIME_WITH_OFFSET_PATTERN.test(value)) return null;

	const parsed = DateTime.fromISO(value, { setZone: true });
	return parsed.isValid ? parsed.toUTC() : null;
}
