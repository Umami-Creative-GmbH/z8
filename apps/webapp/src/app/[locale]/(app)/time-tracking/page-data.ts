import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { normalizeWeekStartDay } from "@/lib/user-preferences/week-start";
import { getTranslate } from "@/tolgee/server";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions";
import { getWorkdayTimelineData } from "./workday-timeline-data";

export interface TimeTrackingPageSearchParams {
	date?: string;
}

export async function getTimeTrackingPageData(searchParams: TimeTrackingPageSearchParams = {}) {
	const session = (await auth.api.getSession({ headers: await headers() }))!;

	const [currentEmployee, settings] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		}),
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, session.user.id),
			columns: { timezone: true, weekStartDay: true },
		}),
	]);

	if (!currentEmployee) {
		return { session, currentEmployee: null } as const;
	}

	const timezone = settings?.timezone || "UTC";
	const weekStartDay = normalizeWeekStartDay(settings?.weekStartDay);
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone, weekStartDay);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;

	const [activeWorkPeriod, workPeriods, summary, t, timelineResult] = await Promise.all([
		getActiveWorkPeriod(currentEmployee.id),
		getWorkPeriods(currentEmployee.id, startDate, endDate),
		getTimeSummary(currentEmployee.id, timezone, weekStartDay),
		getTranslate(),
		getWorkdayTimelineData({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			timezone,
			dateParam: searchParams.date,
		}),
	]);

	return {
		session,
		currentEmployee,
		timezone,
		activeWorkPeriod,
		workPeriods,
		summary,
		t,
		timelineResult,
	} as const;
}
