import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { asAppSubject } from "@/lib/authorization";
import {
	ClockingAccessError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";

/** Read-only recovery access. It neither submits work nor asserts replay absence. */
export async function GET() {
	await connection();
	const responseHeaders = { "Cache-Control": "no-store" };
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401, headers: responseHeaders },
			);
		}
		const actor = await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: session.session.activeOrganizationId,
		});
		const ability = await getAbility();
		return NextResponse.json(
			{
				userId: actor.userId,
				organizationId: actor.organizationId,
				// Missing legacy actor evidence is never assigned to the current user.
				// Only organization-wide time-entry management permits its inspection.
				canReviewLegacy:
					ability?.can(
						"manage",
						asAppSubject("TimeEntry", {
							organizationId: actor.organizationId,
							// No employee-scoped grant can match an unattributed record.
							employeeId: "",
						}),
					) ?? false,
			},
			{ headers: responseHeaders },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: "Clock recovery access unavailable" },
			{
				status: error instanceof ClockingAccessError ? 403 : 500,
				headers: responseHeaders,
			},
		);
	}
}
