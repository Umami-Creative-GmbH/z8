import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { getUserTimezone } from "@/app/[locale]/(app)/time-tracking/actions/auth";
import {
	getActiveWorkPeriod,
	getTimeSummary,
} from "@/app/[locale]/(app)/time-tracking/actions/queries";
import { db } from "@/db";
import { absenceEntry, timeEntry } from "@/db/schema";
import { getTodayRangeInTimezone } from "@/lib/time-tracking/timezone-utils";

function getLatestEventLabel(type: string | null | undefined) {
	if (type === "clock_in") {
		return "Clocked in";
	}

	if (type === "clock_out") {
		return "Clocked out";
	}

	if (type === "correction") {
		return "Updated time";
	}

	return null;
}

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const timezone = await getUserTimezone(session.user.id);
		const { start, end } = getTodayRangeInTimezone(timezone);
		const todayKey = DateTime.now().setZone(timezone).toISODate() ?? DateTime.now().toISODate();

		if (!todayKey) {
			throw new MobileApiError(500, "Failed to resolve current date");
		}

		const [activeWorkPeriod, timeSummary, latestTimeEntry, nextApprovedAbsence] = await Promise.all([
			getActiveWorkPeriod(employeeRecord.id),
			getTimeSummary(employeeRecord.id, timezone),
			db.query.timeEntry.findFirst({
				columns: {
					type: true,
				},
				where: and(
					eq(timeEntry.employeeId, employeeRecord.id),
					eq(timeEntry.organizationId, activeOrganizationId),
					eq(timeEntry.isSuperseded, false),
					gte(timeEntry.timestamp, start.toJSDate()),
					lte(timeEntry.timestamp, end.toJSDate()),
				),
				orderBy: [desc(timeEntry.timestamp)],
			}),
				db.query.absenceEntry.findFirst({
				columns: {
					id: true,
					startDate: true,
					endDate: true,
					startPeriod: true,
					endPeriod: true,
				},
				with: {
					category: {
						columns: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
				where: and(
					eq(absenceEntry.employeeId, employeeRecord.id),
					eq(absenceEntry.organizationId, activeOrganizationId),
					eq(absenceEntry.status, "approved"),
					gte(absenceEntry.startDate, todayKey),
				),
				orderBy: [asc(absenceEntry.startDate)],
			}),
		]);

		return NextResponse.json({
			activeOrganizationId,
			clock: {
				isClockedIn: !!activeWorkPeriod,
				activeWorkPeriod: activeWorkPeriod
					? {
						id: activeWorkPeriod.id,
						startTime: activeWorkPeriod.startTime.toISOString(),
					}
					: null,
			},
			today: {
				minutesWorked: timeSummary.todayMinutes,
				latestEventLabel: getLatestEventLabel(latestTimeEntry?.type),
				nextApprovedAbsence: nextApprovedAbsence
					? {
						id: nextApprovedAbsence.id,
						startDate: nextApprovedAbsence.startDate,
						endDate: nextApprovedAbsence.endDate,
						startPeriod: nextApprovedAbsence.startPeriod,
						endPeriod: nextApprovedAbsence.endPeriod,
						category: nextApprovedAbsence.category,
					}
					: null,
			},
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
