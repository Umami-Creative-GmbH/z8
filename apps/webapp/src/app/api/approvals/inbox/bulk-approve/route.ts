/**
 * Bulk Approve API
 *
 * POST /api/approvals/inbox/bulk-approve - Approve multiple approvals
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { approvalRequest, employee, auditLog } from "@/db/schema";
import { getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalType, BulkApproveResult } from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("BulkApproveAPI");

const MAX_BULK_APPROVE = 50;

export async function POST(request: NextRequest) {
	try {
		// Parse body
		const body = await request.json();
		const approvalIds = body.approvalIds as string[];

		if (!Array.isArray(approvalIds) || approvalIds.length === 0) {
			return NextResponse.json(
				{ error: "approvalIds array is required" },
				{ status: 400 },
			);
		}

		if (approvalIds.length > MAX_BULK_APPROVE) {
			return NextResponse.json(
				{ error: `Maximum ${MAX_BULK_APPROVE} approvals at once` },
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

		// Fetch all approval requests
		const requests = await db.query.approvalRequest.findMany({
			where: inArray(approvalRequest.id, approvalIds),
		});

		const result: BulkApproveResult = {
			succeeded: [],
			failed: [],
		};

		// Process each request
		for (const req of requests) {
			// Validate authorization
			if (req.approverId !== currentEmployee.id) {
				result.failed.push({
					id: req.id,
					error: "Not authorized to approve",
				});
				continue;
			}

			// Validate organization
			if (req.organizationId !== currentEmployee.organizationId) {
				result.failed.push({
					id: req.id,
					error: "Request belongs to different organization",
				});
				continue;
			}

			// Validate status
			if (req.status !== "pending") {
				result.failed.push({
					id: req.id,
					error: `Request is already ${req.status}`,
				});
				continue;
			}

			// Get handler
			const handler = getApprovalHandler(req.entityType as ApprovalType);
			if (!handler) {
				result.failed.push({
					id: req.id,
					error: `Unknown approval type: ${req.entityType}`,
				});
				continue;
			}

			// Check if handler supports bulk approve
			if (!handler.supportsBulkApprove) {
				result.failed.push({
					id: req.id,
					error: `Bulk approve not supported for ${handler.displayName}`,
				});
				continue;
			}

			// Try to approve
			try {
				await Effect.runPromise(
					handler
						.approve(req.entityId, currentEmployee.id)
						.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<void, AnyAppError, never>,
				);

				result.succeeded.push(req.id);

				// Log audit trail
				await db.insert(auditLog).values({
					organizationId: req.organizationId,
					entityType: "approval_request",
					entityId: req.id,
					action: "bulk_approve",
					performedBy: session.user.id,
					changes: JSON.stringify({
						from: "pending",
						to: "approved",
						approvalType: req.entityType,
						targetEntityId: req.entityId,
						bulkOperation: true,
					}),
					timestamp: new Date(),
				});
			} catch (error) {
				result.failed.push({
					id: req.id,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}

		// Check for missing IDs
		const foundIds = new Set(requests.map((r) => r.id));
		for (const id of approvalIds) {
			if (!foundIds.has(id)) {
				result.failed.push({
					id,
					error: "Approval request not found",
				});
			}
		}

		logger.info(
			{
				requested: approvalIds.length,
				succeeded: result.succeeded.length,
				failed: result.failed.length,
				approverId: currentEmployee.id,
			},
			"Bulk approve completed",
		);

		return NextResponse.json(result);
	} catch (error) {
		logger.error({ error }, "Failed to bulk approve");
		return NextResponse.json(
			{ error: "Failed to process bulk approval" },
			{ status: 500 },
		);
	}
}
