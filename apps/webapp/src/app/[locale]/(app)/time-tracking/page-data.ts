import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type {
	SerializableWorkdayTimelineItem,
	SerializableWorkdayTimelineResult,
} from "@/components/time-tracking/personal-workday-timeline";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { normalizeTimeFormat } from "@/lib/user-preferences/time-format";
import { normalizeWeekStartDay } from "@/lib/user-preferences/week-start";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import { getTranslate } from "@/tolgee/server";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineItem,
	WorkdayTimelineResult,
} from "./workday-timeline.types";
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
			columns: { timezone: true, weekStartDay: true, timeFormat: true },
		}),
	]);

	if (!currentEmployee) {
		return { session, currentEmployee: null } as const;
	}

	const timezone = settings?.timezone || "UTC";
	const weekStartDay = normalizeWeekStartDay(settings?.weekStartDay);
	const timeFormat = normalizeTimeFormat(settings?.timeFormat);
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone, weekStartDay);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, session.user.id),
			eq(authSchema.member.organizationId, currentEmployee.organizationId),
		),
		columns: { role: true },
	});
	const canApproveTimeEntries = memberRecord?.role === "admin" || memberRecord?.role === "owner";

	const [activeWorkPeriod, workPeriods, summary, t, timelineResult, workBalance] =
		await Promise.all([
			getActiveWorkPeriod(currentEmployee.id),
			getWorkPeriods(currentEmployee.id, startDate, endDate),
			getTimeSummary(currentEmployee.id, timezone, weekStartDay),
			getTranslate(),
			getWorkdayTimelineData({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				timezone,
				timeFormat,
				dateParam: searchParams.date,
			}),
			getSafeEmployeeWorkBalance({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
			}),
		]);

	return {
		session,
		currentEmployee,
		timezone,
		timeFormat,
		activeWorkPeriod,
		workPeriods,
		canApproveTimeEntries,
		summary,
		workBalance,
		t,
		timelineResult: serializeWorkdayTimelineResult(timelineResult),
	} as const;
}

export async function getSafeEmployeeWorkBalance(
	params: Parameters<typeof getEmployeeWorkBalance>[0],
) {
	try {
		return await getEmployeeWorkBalance(params);
	} catch (error) {
		console.error("Failed to load employee work balance", { ...params, error });
		return null;
	}
}

function serializeWorkdayTimelineResult(
	result: WorkdayTimelineResult,
): SerializableWorkdayTimelineResult {
	if (!result.success) {
		return {
			success: false,
			selectedDate: serializeSelectedDate(result.selectedDate),
			error: result.error,
		};
	}

	return {
		success: true,
		data: {
			...result.data,
			selectedDate: serializeSelectedDate(result.data.selectedDate),
			items: result.data.items.map(serializeTimelineItem),
			dayWarnings: result.data.dayWarnings.map(serializeTimelineItem),
		},
	};
}

function serializeSelectedDate({
	dateKey,
	todayDateKey,
	previousDateKey,
	nextDateKey,
	label,
}: SelectedWorkdayDate) {
	return { dateKey, todayDateKey, previousDateKey, nextDateKey, label };
}

function serializeTimelineItem({
	id,
	type,
	title,
	subtitle,
	startLabel,
	endLabel,
	badge,
	severity,
	link,
}: WorkdayTimelineItem): SerializableWorkdayTimelineItem {
	return { id, type, title, subtitle, startLabel, endLabel, badge, severity, link };
}
