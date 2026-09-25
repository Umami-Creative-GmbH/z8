import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { lookupClockCommand } from "@/app/[locale]/(app)/time-tracking/actions/clock-command";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ClockCommandLookup");
const noStore = { "Cache-Control": "no-store" };
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * GET /api/time-entries/commands/{operationId}
 * Lookup-only recovery of one frozen clock command (#275), scoped to the
 * authenticated employee in the active organization. It never creates work.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ operationId: string }> },
) {
	await connection();
	const { operationId } = await params;
	if (!OPERATION_ID.test(operationId)) {
		return NextResponse.json(
			{ outcome: "rejected", code: "invalid_operation_id" },
			{ status: 400, headers: noStore },
		);
	}
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json(
			{ outcome: "rejected", code: "unauthorized" },
			{ status: 401, headers: noStore },
		);
	}
	try {
		const lookup = await lookupClockCommand({
			operationId,
			session: {
				userId: session.user.id,
				activeOrganizationId: session.session.activeOrganizationId,
			},
		});
		return NextResponse.json(lookup, {
			status: lookup.outcome === "rejected" ? 403 : 200,
			headers: noStore,
		});
	} catch (error) {
		logger.error({ error, operationId }, "Clock command lookup failed");
		return NextResponse.json(
			{ outcome: "unavailable", operationId },
			{ status: 500, headers: noStore },
		);
	}
}
