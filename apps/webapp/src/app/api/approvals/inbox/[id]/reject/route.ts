/**
 * Reject API
 *
 * POST /api/approvals/inbox/[id]/reject - Reject a single approval
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { approvalRequest, employee, auditLog } from "@/db/schema";
import { getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("RejectAPI");

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;

		// Parse body
		const body = await request.json();
		const reason = body.reason as string;

		if (!reason || reason.trim().length === 0) {
			return NextResponse.json(
				{ error: "Rejection reason is required" },
				{ status: 400 },
			);
		}

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
		const approvalReq = await db.query.approvalRequest.findFirst({
			where: eq(approvalRequest.id, id),
		});

		if (!approvalReq) {
			return NextResponse.json({ error: "Approval not found" }, { status: 404 });
		}

		// Verify authorization - must be the approver and in the same organization
		if (approvalReq.approverId !== currentEmployee.id) {
			return NextResponse.json(
				{ error: "You are not authorized to reject this request" },
				{ status: 403 },
			);
		}

		if (approvalReq.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		// Check status
		if (approvalReq.status !== "pending") {
			return NextResponse.json(
				{ error: `Request is already ${approvalReq.status}` },
				{ status: 400 },
			);
		}

		// Get handler
		const handler = getApprovalHandler(approvalReq.entityType as ApprovalType);
		if (!handler) {
			return NextResponse.json(
				{ error: `Unknown approval type: ${approvalReq.entityType}` },
				{ status: 400 },
			);
		}

		// Execute rejection
		await Effect.runPromise(
			handler
				.reject(approvalReq.entityId, currentEmployee.id, reason)
				.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<void, AnyAppError, never>,
		);

		// Log audit trail
		await db.insert(auditLog).values({
			organizationId: approvalReq.organizationId,
			entityType: "approval_request",
			entityId: id,
			action: "reject",
			performedBy: session.user.id,
			changes: JSON.stringify({
				from: "pending",
				to: "rejected",
				approvalType: approvalReq.entityType,
				targetEntityId: approvalReq.entityId,
				reason,
			}),
			timestamp: new Date(),
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

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Failed to reject");
		return NextResponse.json(
			{ success: false, error: "Failed to reject request" },
			{ status: 500 },
		);
	}
}
