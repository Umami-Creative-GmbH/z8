import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { checkVehicleUseWarnings } from "@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings";
import { auth } from "@/lib/auth";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { desktopVehicleUseWarningsSchema } from "@/lib/time-tracking/vehicle-use/vehicle-use-warnings-input";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/desktop/vehicle-use-warnings (#1124): the plausibility warnings
 * (#1121) for vehicle use the desktop is about to send with a clock-in, or with
 * the clock-out of the signed-in employee's live work (`closingWorkPeriodId`).
 * Like the other desktop routes it needs a session and, for the active
 * organization, any SSO the organization requires (401/403 otherwise). The same
 * server action as the web clock answers. Warnings are advice and never block a
 * clock event, so a failed check answers none.
 */
export async function POST(request: Request) {
	await connection();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
	}
	const organizationId = session.session.activeOrganizationId;
	if (!organizationId) {
		return NextResponse.json(
			{ error: "Select an organization" },
			{ status: 400, headers: NO_STORE },
		);
	}
	if (!(await canAccessOrganizationWithSso(session.session, organizationId))) {
		return NextResponse.json(
			{ error: "Organization SSO required" },
			{ status: 403, headers: NO_STORE },
		);
	}
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return NextResponse.json({ warnings: [] }, { status: 400, headers: NO_STORE });
	}
	const body = desktopVehicleUseWarningsSchema.safeParse(raw);
	if (!body.success) {
		return NextResponse.json({ warnings: [] }, { status: 400, headers: NO_STORE });
	}
	const result = await checkVehicleUseWarnings({
		vehicleUse: body.data.vehicleUse,
		...(body.data.closingWorkPeriodId
			? { closingWorkPeriodId: body.data.closingWorkPeriodId }
			: {}),
	});
	return NextResponse.json(
		{ warnings: result.success ? result.data.warnings : [] },
		{ headers: NO_STORE },
	);
}
