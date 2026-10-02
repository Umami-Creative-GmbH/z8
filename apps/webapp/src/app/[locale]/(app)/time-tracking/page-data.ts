import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getRenderSession } from "@/lib/auth/render-session";
import { getTranslate } from "@/tolgee/server";
import { readActiveWorkPeriod } from "./read-queries";
import { readHistoryRegion, readSummaryRegion } from "./region-data";
import { getTimeTrackingRenderContext } from "./render-context";
import { serializeWorkdayTimelineResult } from "./timeline-serialization";
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
	if (!context.employee) {
		return { session, currentEmployee: null } as const;
	}
	const { employee: currentEmployee, timezone, timeFormat } = context;
	const scope = {
		employeeId: currentEmployee.id,
		organizationId: currentEmployee.organizationId,
	};

	const [activeWorkPeriod, history, summaryData, t, timelineResult] =
		await Promise.all([
			readActiveWorkPeriod(scope),
			readHistoryRegion(context),
			readSummaryRegion(context),
			getTranslate(),
			getWorkdayTimelineData({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				timezone,
				timeFormat,
				dateParam: searchParams.date,
			}),
		]);

	return {
		session,
		currentEmployee,
		timezone,
		timeFormat,
		activeWorkPeriod,
		...history,
		...summaryData,
		t,
		timelineResult: serializeWorkdayTimelineResult(timelineResult),
	} as const;
}
