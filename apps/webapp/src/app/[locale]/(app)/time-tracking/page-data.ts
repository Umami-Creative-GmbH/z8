import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { getTranslate } from "@/tolgee/server";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions";

export async function getTimeTrackingPageData() {
	const session = (await auth.api.getSession({ headers: await headers() }))!;

	const [currentEmployee, settings] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		}),
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, session.user.id),
			columns: { timezone: true },
		}),
	]);

	if (!currentEmployee) {
		return { session, currentEmployee: null } as const;
	}

	const timezone = settings?.timezone || "UTC";
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;

	const [activeWorkPeriod, workPeriods, summary, t] = await Promise.all([
		getActiveWorkPeriod(currentEmployee.id),
		getWorkPeriods(currentEmployee.id, startDate, endDate),
		getTimeSummary(currentEmployee.id, timezone),
		getTranslate(),
	]);

	return {
		session,
		currentEmployee,
		timezone,
		activeWorkPeriod,
		workPeriods,
		summary,
		t,
	} as const;
}
