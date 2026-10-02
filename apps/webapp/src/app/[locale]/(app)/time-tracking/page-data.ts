import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type {
	SerializableWorkdayTimelineItem,
	SerializableWorkdayTimelineResult,
} from "@/components/time-tracking/personal-workday-timeline";
import { db } from "@/db";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { getRenderSession } from "@/lib/auth/render-session";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import { getTranslate } from "@/tolgee/server";
import {
	readActiveWorkPeriod,
	readTimeSummary,
	readWorkPeriods,
} from "./read-queries";
import { getTimeTrackingRenderContext } from "./render-context";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineItem,
	WorkdayTimelineResult,
} from "./workday-timeline.types";
import { getWorkdayTimelineData } from "./workday-timeline-data";

export interface TimeTrackingPageSearchParams {
	date?: string;
}

export async function getTimeTrackingPageData(
	searchParams: TimeTrackingPageSearchParams = {},
) {
	const [context, session] = await Promise.all([
		getTimeTrackingRenderContext(),
		getRenderSession(),
	]);
	if (!context || !session?.user) {
		const locale = await getLocale();
		const pathname =
			(await headers()).get("x-pathname") || `/${locale}/time-tracking`;
		redirect(
			`/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`,
		);
	}
	const {
		employee: currentEmployee,
		timezone,
		weekStartDay,
		timeFormat,
		membershipRole,
	} = context;

	if (!currentEmployee) {
		return { session, currentEmployee: null } as const;
	}

	const { start, end } = getWeekRangeInTimezone(
		new Date(),
		timezone,
		weekStartDay,
	);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;
	const canApproveTimeEntries =
		membershipRole === "admin" || membershipRole === "owner";
	const scope = {
		employeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
	};

	const [
		activeWorkPeriod,
		workPeriods,
		summary,
		t,
		timelineResult,
		workBalance,
		managerId,
	] = await Promise.all([
		readActiveWorkPeriod(scope),
		readWorkPeriods(scope, startDate, endDate),
		readTimeSummary(scope, timezone, weekStartDay),
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
		getPrimaryEligibleManagerIdForRequester({
			db,
			requesterEmployeeId: currentEmployee.id,
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
		hasManager: Boolean(managerId),
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
	return {
		id,
		type,
		title,
		subtitle,
		startLabel,
		endLabel,
		badge,
		severity,
		link,
	};
}
