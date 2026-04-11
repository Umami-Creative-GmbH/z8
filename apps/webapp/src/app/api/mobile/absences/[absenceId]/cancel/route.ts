import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { cancelAbsenceRequestForEmployee } from "@/app/[locale]/(app)/absences/actions";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ absenceId: string }> },
) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const { absenceId } = await params;
		const result = await cancelAbsenceRequestForEmployee(absenceId, employeeRecord);

		if (!result.success) {
			return NextResponse.json({ error: result.error ?? "Failed to cancel absence" }, { status: 400 });
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
