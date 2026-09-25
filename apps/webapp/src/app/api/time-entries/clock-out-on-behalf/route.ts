import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
	closeWorkOnBehalf,
	type OnBehalfClockOutRejection,
} from "@/app/[locale]/(app)/time-tracking/actions/clock-out-on-behalf";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { auth } from "@/lib/auth";
import { createBillingForbiddenResponse } from "@/lib/billing/guard";
import { parseOnBehalfClockOutRequest } from "@/lib/time-tracking/on-behalf-clock-out-request";

/**
 * Manager on-behalf clock-out (#276). Closes the named running work period of
 * another employee at the current server time.
 *
 * Body: `{ workPeriodId, operationId?, projectId?, workCategoryId? }`. The client
 * mints `operationId` once per intended closure and resends it on every retry, so
 * a lost response is recovered as the original committed outcome (200). Omitted
 * attribution preserves the period's; `null` clears it; an ID replaces it.
 */
const REJECTIONS: Record<
	Exclude<OnBehalfClockOutRejection["code"], "billing_required" | "attribution_not_allowed">,
	{ status: number; error: string }
> = {
	access_denied: { status: 403, error: "Not authorized to clock out this employee" },
	target_unknown: { status: 404, error: "Work period not found" },
	target_not_active: { status: 409, error: "Work period is no longer running" },
	collision: { status: 409, error: "This clock-out request conflicts with another one" },
	invalid_interval: { status: 409, error: "Clock-out must be after clock-in" },
	append_review_required: {
		status: 409,
		error: "Clock out was not saved because time history needs review",
	},
	integrity_review_required: {
		status: 409,
		error: "Clock out was not saved because committed work needs review",
	},
};

function rejected(rejection: OnBehalfClockOutRejection, operationId: string | null) {
	if (rejection.code === "billing_required") {
		return createBillingForbiddenResponse(rejection.billing);
	}
	if (rejection.code === "attribution_not_allowed") {
		return NextResponse.json(
			{
				error:
					rejection.field === "projectId"
						? "Cannot assign to this project"
						: "Cannot assign to this work category",
				code: rejection.code,
				field: rejection.field,
				operationId,
			},
			{ status: 422 },
		);
	}
	const { status, error } = REJECTIONS[rejection.code];
	return NextResponse.json({ error, code: rejection.code, operationId }, { status });
}

export async function POST(request: NextRequest) {
	await connection();

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		body = null;
	}
	const parsed = parseOnBehalfClockOutRequest(body);
	if (!parsed) {
		return NextResponse.json(
			{ error: "workPeriodId is required; operationId must be a lowercase UUID" },
			{ status: 400 },
		);
	}

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const activeOrganizationId = session.session.activeOrganizationId;
	if (!activeOrganizationId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	try {
		const result = await closeWorkOnBehalf({
			request: parsed,
			session: { userId: session.user.id, activeOrganizationId },
		});
		if (result.outcome === "rejected") {
			const { outcome: _outcome, operationId, ...rejection } = result;
			return rejected(rejection as OnBehalfClockOutRejection, operationId);
		}
		return NextResponse.json(result, { status: result.outcome === "executed" ? 201 : 200 });
	} catch (error) {
		logger.error({ error }, "On-behalf clock-out failed");
		// The work may or may not have committed; resending the same identity replays it.
		return NextResponse.json(
			{
				error: "Internal server error",
				outcome: "unknown",
				operationId: parsed.operationId ?? null,
			},
			{ status: 500 },
		);
	}
}
