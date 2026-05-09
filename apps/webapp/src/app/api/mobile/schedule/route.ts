import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { db } from "@/db";
import { shift } from "@/db/schema";
import { getMobileEffectiveSchedule } from "@/lib/mobile/effective-schedule";

function toUtcDateKey(date: Date) {
	const dateKey = DateTime.fromJSDate(date, { zone: "utc" }).toISODate();

	if (!dateKey) {
		throw new MobileApiError(500, "Failed to resolve shift date");
	}

	return dateKey;
}

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const startDate = DateTime.now().toUTC().startOf("day");
		const endDate = startDate.plus({ days: 27 }).endOf("day");

		const [shifts, effectiveSchedule] = await Promise.all([
			db.query.shift.findMany({
				columns: {
					id: true,
					date: true,
					startTime: true,
					endTime: true,
					status: true,
					notes: true,
					color: true,
				},
				where: and(
					eq(shift.organizationId, activeOrganizationId),
					eq(shift.employeeId, employeeRecord.id),
					eq(shift.status, "published"),
					gte(shift.date, startDate.toJSDate()),
					lte(shift.date, endDate.toJSDate()),
				),
				orderBy: [asc(shift.date), asc(shift.startTime)],
			}),
			getMobileEffectiveSchedule(employeeRecord.id, activeOrganizationId),
		]);

		return NextResponse.json({
			activeOrganizationId,
			shifts: shifts.map((scheduledShift) => ({
				id: scheduledShift.id,
				date: toUtcDateKey(scheduledShift.date),
				startTime: scheduledShift.startTime,
				endTime: scheduledShift.endTime,
				status: scheduledShift.status,
				notes: scheduledShift.notes,
				color: scheduledShift.color,
			})),
			effectiveSchedule,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
