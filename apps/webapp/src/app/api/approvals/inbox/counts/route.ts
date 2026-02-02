/**
 * Approval Counts API
 *
 * GET /api/approvals/inbox/counts - Get pending approval counts per type
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { getAllApprovalHandlers } from "@/lib/approvals/domain/registry";
import type { ApprovalType } from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { AnyAppError } from "@/lib/effect/errors";
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
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		// Check CASL permissions - must be able to approve or manage approvals
		const ability = await getAbility();
		if (!ability || (ability.cannot("approve", "Approval") && ability.cannot("manage", "Approval"))) {
			const error = new ForbiddenError("approve", "Approval");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
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

		// Get counts from all handlers
		const handlers = getAllApprovalHandlers();
		const counts: Partial<Record<ApprovalType, number>> = {};

		for (const handler of handlers) {
			const count = await Effect.runPromise(
				handler
					.getCount(currentEmployee.id, currentEmployee.organizationId)
					.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<number, AnyAppError, never>,
			);
			counts[handler.type] = count;
		}

		return NextResponse.json(counts);
	} catch (error) {
		logger.error({ error }, "Failed to fetch approval counts");
		return NextResponse.json(
			{ error: "Failed to fetch approval counts" },
			{ status: 500 },
		);
	}
}
