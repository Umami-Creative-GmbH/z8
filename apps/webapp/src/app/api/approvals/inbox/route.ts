/**
 * Unified Approval Inbox API
 *
 * GET /api/approvals/inbox - Get paginated approvals
 */

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import {
	ApprovalQueryService,
	ApprovalQueryServiceLive,
} from "@/lib/approvals/application/approval-query.service";
import type {
	ApprovalPriority,
	PaginatedApprovalResult,
	ApprovalQueryParams,
	ApprovalStatus,
	ApprovalType,
} from "@/lib/approvals/domain/types";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import type { AnyAppError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApprovalInboxAPI");

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

		// Check CASL permissions - must be able to approve or manage approvals
		const ability = await getAbility();
		if (
			!ability ||
			(ability.cannot("approve", "Approval") && ability.cannot("manage", "Approval"))
		) {
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

		// Parse query parameters
		const { searchParams } = new URL(request.url);

		const status = (searchParams.get("status") as ApprovalStatus) || "pending";
		const typesParam = searchParams.get("types");
		const types = typesParam ? (typesParam.split(",") as ApprovalType[]) : undefined;
		const teamId = searchParams.get("teamId") || undefined;
		const search = searchParams.get("search") || undefined;
		const priority = searchParams.get("priority") as ApprovalPriority | undefined;
		const minAgeDays = searchParams.get("minAgeDays")
			? parseInt(searchParams.get("minAgeDays")!, 10)
			: undefined;
		const cursor = searchParams.get("cursor") || undefined;
		const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

		// Date range filter
		let dateRange: { from: Date; to: Date } | undefined;
		const dateFrom = searchParams.get("dateFrom");
		const dateTo = searchParams.get("dateTo");
		if (dateFrom && dateTo) {
			dateRange = {
				from: new Date(dateFrom),
				to: new Date(dateTo),
			};
		}

		// Build query params
		const params: ApprovalQueryParams = {
			approverId: currentEmployee.id,
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
		};

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const approvalQueryService = yield* _(ApprovalQueryService);
				return yield* _(approvalQueryService.getApprovals(params));
			}).pipe(Effect.provide(ApprovalQueryServiceLive)) as Effect.Effect<
				PaginatedApprovalResult,
				AnyAppError,
				never
			>,
		);

		return NextResponse.json({
			items: result.items,
			nextCursor: result.nextCursor,
			hasMore: result.hasMore,
			total: result.total,
		});
	} catch (error) {
		if (error instanceof Error && "digest" in error) {
			throw error;
		}

		logger.error({ error }, "Failed to fetch approvals");
		return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
	}
}
