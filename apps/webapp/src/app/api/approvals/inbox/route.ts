/**
 * Unified Approval Inbox API
 *
 * GET /api/approvals/inbox - Get paginated approvals
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getAllApprovalHandlers } from "@/lib/approvals/domain/registry";
import { comparePriority } from "@/lib/approvals/domain/sla-calculator";
import type {
	ApprovalPriority,
	ApprovalQueryParams,
	ApprovalStatus,
	ApprovalType,
	UnifiedApprovalItem,
} from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
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
			),
		});

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Only managers and admins can access approvals
		if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Parse query parameters
		const { searchParams } = new URL(request.url);

		const status = (searchParams.get("status") as ApprovalStatus) || "pending";
		const typesParam = searchParams.get("types");
		const types = typesParam
			? (typesParam.split(",") as ApprovalType[])
			: undefined;
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

		// Get handlers
		const handlers = getAllApprovalHandlers();
		const activeHandlers = types
			? handlers.filter((h) => types.includes(h.type))
			: handlers;

		// Fetch from all handlers
		const allItems: UnifiedApprovalItem[] = [];

		for (const handler of activeHandlers) {
			const result = await Effect.runPromise(
				handler.getApprovals(params).pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<UnifiedApprovalItem[], AnyAppError, never>,
			);
			allItems.push(...result);
		}

		// Sort by priority then by createdAt
		allItems.sort((a, b) => {
			const priorityDiff = comparePriority(a.priority, b.priority);
			if (priorityDiff !== 0) return priorityDiff;
			return b.createdAt.getTime() - a.createdAt.getTime();
		});

		// Apply pagination
		const hasMore = allItems.length > limit;
		const items = allItems.slice(0, limit);
		const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

		return NextResponse.json({
			items,
			nextCursor,
			hasMore,
			total: allItems.length,
		});
	} catch (error) {
		logger.error({ error }, "Failed to fetch approvals");
		return NextResponse.json(
			{ error: "Failed to fetch approvals" },
			{ status: 500 },
		);
	}
}
