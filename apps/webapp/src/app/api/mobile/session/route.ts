import { NextResponse } from "next/server";
import {
	MobileApiError,
	getMobileOrganizationSummary,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId, memberships } = await requireMobileSessionContext(request);
		const organizations = await Promise.all(
			memberships.map(({ organizationId }) =>
				getMobileOrganizationSummary(session.user.id, organizationId),
			),
		);

		return NextResponse.json({
			user: {
				id: session.user.id,
				name: session.user.name,
				email: session.user.email,
			},
			activeOrganizationId,
			organizations,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
