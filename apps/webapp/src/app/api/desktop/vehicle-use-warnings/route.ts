import { connection, NextResponse } from "next/server";
import { checkVehicleUseWarnings } from "@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings";

/**
 * POST /api/desktop/vehicle-use-warnings (#1124): the plausibility warnings
 * (#1121) for vehicle use the desktop is about to send with a clock-in, or with
 * the clock-out of the signed-in employee's live work (`closingWorkPeriodId`).
 * The same server action as the web clock answers, in the session's active
 * organization. Warnings are advice and never block a clock event, so a failed
 * check answers none.
 */
export async function POST(request: Request) {
	await connection();
	let body: { vehicleUse?: unknown; closingWorkPeriodId?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ warnings: [] }, { status: 400 });
	}
	const result = await checkVehicleUseWarnings({
		vehicleUse: body?.vehicleUse as never,
		...(typeof body?.closingWorkPeriodId === "string"
			? { closingWorkPeriodId: body.closingWorkPeriodId }
			: {}),
	});
	return NextResponse.json(
		{ warnings: result.success ? result.data.warnings : [] },
		{ headers: { "Cache-Control": "private, no-store" } },
	);
}
