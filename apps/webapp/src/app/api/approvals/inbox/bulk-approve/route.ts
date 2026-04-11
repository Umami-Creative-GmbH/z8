/**
 * Bulk Approve API
 *
 * POST /api/approvals/inbox/bulk-approve - Approve multiple approvals
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { db } from "@/db";
import { employee } from "@/db/schema";
import type { BulkDecisionResult } from "@/lib/approvals/domain/types";
import { BulkApprovalService, BulkApprovalServiceLive } from "@/lib/approvals/application/bulk-approval.service";
import type { AnyAppError } from "@/lib/effect/errors";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
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

		// Get active organization from session
		const activeOrganizationId = session.session?.activeOrganizationId;
		if (!activeOrganizationId) {
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		const ability = await getAbility();
		if (
			!ability ||
			(ability.cannot("approve", "Approval") && ability.cannot("manage", "Approval"))
		) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		// Get current employee scoped to active organization
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

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const bulkApprovalService = yield* _(BulkApprovalService);
				return yield* _(
					bulkApprovalService.bulkDecide(
						approvalIds,
						currentEmployee.id,
						currentEmployee.organizationId,
						"approve",
						undefined,
						session.user.id,
					),
				);
			}).pipe(Effect.provide(BulkApprovalServiceLive)) as Effect.Effect<
				BulkDecisionResult,
				AnyAppError,
				never
			>,
		);

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
