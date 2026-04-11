/**
 * Approve API
 *
 * POST /api/approvals/inbox/[id]/approve - Approve a single approval
 */

import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import { ApprovalAuditLoggerLive } from "@/lib/approvals/infrastructure/audit-logger";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApproveAPI");

function toApprovalErrorResponse(error: unknown) {
	if (error instanceof ConflictError) {
		return NextResponse.json({ error: error.message }, { status: 409 });
	}

	if (error instanceof AuthorizationError) {
		return NextResponse.json({ error: error.message }, { status: 403 });
	}

	if (error instanceof NotFoundError) {
		return NextResponse.json({ error: error.message }, { status: 404 });
	}

	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}

	return null;
}

function extractApprovalError(cause: Cause.Cause<AnyAppError>) {
	return Option.getOrNull(Cause.failureOption(cause)) ?? [...Cause.defects(cause)][0] ?? cause;
}

export async function POST(
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

		// Get the approval request
		const request = await db.query.approvalRequest.findFirst({
			where: eq(approvalRequest.id, id),
		});

		if (!request) {
			return NextResponse.json({ error: "Approval not found" }, { status: 404 });
		}

		// Verify authorization - must be the approver and in the same organization
		if (request.approverId !== currentEmployee.id) {
			return NextResponse.json(
				{ error: "You are not authorized to approve this request" },
				{ status: 403 },
			);
		}

		if (request.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Approval not found" },
				{ status: 404 },
			);
		}

		// Check status
		if (request.status !== "pending") {
			return NextResponse.json(
				{ error: `Request is already ${request.status}` },
				{ status: 409 },
			);
		}

		// Get handler
		const handler = getApprovalHandler(request.entityType as ApprovalType);
		if (!handler) {
			return NextResponse.json(
				{ error: `Unknown approval type: ${request.entityType}` },
				{ status: 400 },
			);
		}

		// Execute approval
		const exit = await Effect.runPromiseExit(
			handler
				.approve(request.entityId, currentEmployee.id)
				.pipe(
					Effect.provide(DatabaseServiceLive),
					Effect.provide(ApprovalAuditLoggerLive),
				) as Effect.Effect<void, AnyAppError, never>,
		);

		if (Exit.isFailure(exit)) {
			const errorResponse = toApprovalErrorResponse(extractApprovalError(exit.cause));
			if (errorResponse) {
				return errorResponse;
			}

			throw extractApprovalError(exit.cause);
		}

		logger.info(
			{
				approvalId: id,
				entityType: request.entityType,
				entityId: request.entityId,
				approverId: currentEmployee.id,
			},
			"Approval approved via unified inbox",
		);

		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ error }, "Failed to approve");
		return NextResponse.json(
			{ success: false, error: "Failed to approve request" },
			{ status: 500 },
		);
	}
}
