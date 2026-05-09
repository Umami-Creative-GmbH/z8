import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const result = await getSelfServiceRequests({
			employeeId: employeeRecord.id,
			organizationId: activeOrganizationId,
		});

		return NextResponse.json({
			items: result.items,
			counts: result.counts,
			sourceErrors: result.sourceErrors,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
