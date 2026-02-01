/**
 * Approval Detail API
 *
 * GET /api/approvals/inbox/[id] - Get approval detail for slide-over panel
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";
import type { ApprovalDetail } from "@/lib/approvals/domain/types";
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

		// Get current employee
		const currentEmployee = await db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		});

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Get the approval request
		const request = await db.query.approvalRequest.findFirst({
			where: eq(approvalRequest.id, id),
		});

		if (!request) {
			return NextResponse.json({ error: "Approval not found" }, { status: 404 });
		}

		// Verify authorization - must be in the same organization
		if (request.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json({ error: "Approval not found" }, { status: 404 });
		}

		// Must be the approver or an admin
		if (
			request.approverId !== currentEmployee.id &&
			currentEmployee.role !== "admin"
		) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Get handler
		const handler = getApprovalHandler(request.entityType as ApprovalType);
		if (!handler) {
			return NextResponse.json(
				{ error: `Unknown approval type: ${request.entityType}` },
				{ status: 400 },
			);
		}

		// Fetch detail with organization validation
		const detail = await Effect.runPromise(
			handler
				.getDetail(request.entityId, currentEmployee.organizationId)
				.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<ApprovalDetail<unknown>, AnyAppError, never>,
		);

		return NextResponse.json(detail);
	} catch (error) {
		logger.error({ error }, "Failed to fetch approval detail");
		return NextResponse.json(
			{ error: "Failed to fetch approval detail" },
			{ status: 500 },
		);
	}
}
