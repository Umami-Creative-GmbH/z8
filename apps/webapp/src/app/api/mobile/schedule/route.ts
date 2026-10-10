import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { systemClock } from "@/lib/datetime/temporal-core";
import { getMobileEffectiveSchedule } from "@/lib/mobile/effective-schedule";
import { loadMobileScheduleShifts } from "@/lib/mobile/schedule-shifts";

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);

		const [shifts, effectiveSchedule] = await Promise.all([
			loadMobileScheduleShifts({
				organizationId: activeOrganizationId,
				employeeId: employeeRecord.id,
				now: systemClock.nowInstant(),
			}),
			getMobileEffectiveSchedule(employeeRecord.id, activeOrganizationId),
		]);

		return NextResponse.json({
			activeOrganizationId,
			shifts,
			effectiveSchedule,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
