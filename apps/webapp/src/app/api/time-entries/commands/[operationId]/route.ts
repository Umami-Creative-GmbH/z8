import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { CLOCK_COMMAND_OPERATION_ID } from "@/lib/time-tracking/clock-command";
import { clocking } from "@/lib/time-tracking/clocking";
import { ClockingAccessError } from "@/lib/time-tracking/clocking-service";
import { type FrozenCommandActor, lookupQuery, requireCommandActor } from "../frozen-clock-command";

const logger = createLogger("ClockCommandLookup");
const noStore = { "Cache-Control": "no-store" };

/**
 * GET /api/time-entries/commands/{operationId}
 * Lookup-only recovery of one frozen clock command (#275), scoped to the
 * authenticated employee in the active organization, through the Clocking
 * module's `lookup`. It never creates work.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ operationId: string }> },
) {
	await connection();
	const { operationId } = await params;
	if (!CLOCK_COMMAND_OPERATION_ID.test(operationId)) {
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
	const accessDenied = () =>
		NextResponse.json(
			{ outcome: "rejected", code: "access_denied" },
			{ status: 403, headers: noStore },
		);
	try {
		let actor: FrozenCommandActor;
		try {
			actor = await requireCommandActor(session);
		} catch (error) {
			if (error instanceof ClockingAccessError) return accessDenied();
			throw error;
		}
		const found = await clocking.lookup(lookupQuery(actor, operationId));
		if (found.outcome === "access_denied") return accessDenied();
		// A client whose captured context differs pauses instead of looking up.
		return NextResponse.json({ ...found, operationId }, { headers: noStore });
	} catch (error) {
		logger.error({ error, operationId }, "Clock command lookup failed");
		return NextResponse.json(
			{ outcome: "unavailable", operationId },
			{ status: 500, headers: noStore },
		);
	}
}
