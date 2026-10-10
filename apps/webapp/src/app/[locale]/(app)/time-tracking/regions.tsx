import "server-only";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { PeriodSubmissionsCard } from "@/components/time-tracking/period-submissions-card";
import { PersonalWorkdayTimeline } from "@/components/time-tracking/personal-workday-timeline";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { getTranslate } from "@/tolgee/server";
import type { TimeTrackingPageSearchParams } from "./page-data";
import { readActiveWorkPeriod } from "./read-queries";
import { readHistoryRegion, readPeriodsRegion, readSummaryRegion } from "./region-data";
import {
	ClockLoading,
	HistoryLoading,
	PeriodsLoading,
	RegionLoadError,
	SummaryLoading,
	TimelineLoading,
} from "./region-fallbacks";
import {
	type EmployeeRenderContext,
	getTimeTrackingRenderContext,
} from "./render-context";
import { serializeWorkdayTimelineResult } from "./timeline-serialization";
import { getWorkdayTimelineData } from "./workday-timeline-data";

export async function ClockRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let activeWorkPeriod: Awaited<ReturnType<typeof readActiveWorkPeriod>>;
	let employeeName: string;
	try {
		activeWorkPeriod = await readActiveWorkPeriod({
			employeeId: context.employee.id,
			organizationId: context.employee.organizationId,
		});
		employeeName =
			context.employeeName ||
			(await getTranslate())("common.employee", "Employee");
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div className="px-4 lg:px-6">
				<RegionLoadError label={t("timeTracking.title", "Time Tracking")} />
			</div>
		);
	}
	return (
		<div className="px-4 lg:px-6">
			<ClockInOutWidget
				activeWorkPeriod={activeWorkPeriod}
				employeeName={employeeName}
				timeFormat={context.timeFormat}
			/>
		</div>
	);
}

export async function TimelineRegion({
	context,
	searchParams,
}: {
	context: EmployeeRenderContext;
	searchParams: Promise<TimeTrackingPageSearchParams>;
}): Promise<ReactNode> {
	let result: Awaited<ReturnType<typeof getWorkdayTimelineData>>;
	try {
		const { date } = await searchParams;
		result = await getWorkdayTimelineData({
			employeeId: context.employee.id,
			organizationId: context.employee.organizationId,
			timezone: context.timezone,
			timeFormat: context.timeFormat,
			dateParam: date,
		});
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div className="px-4 lg:px-6">
				<RegionLoadError
					label={t("timeTracking.timeline.title", "Workday timeline")}
				/>
			</div>
		);
	}
	return (
		<div className="px-4 lg:px-6">
			<PersonalWorkdayTimeline
				result={serializeWorkdayTimelineResult(result)}
			/>
		</div>
	);
}

export async function SummaryRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readSummaryRegion>>;
	try {
		data = await readSummaryRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div className="px-4 lg:px-6">
				<RegionLoadError
					label={t("timeTracking.summary.thisWeek", "This Week")}
				/>
			</div>
		);
	}
	return (
		<WeeklySummaryCards summary={data.summary} workBalance={data.workBalance} />
	);
}

export async function PeriodsRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readPeriodsRegion>>;
	try {
		data = await readPeriodsRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div className="px-4 lg:px-6">
				<RegionLoadError
					label={t("timeTracking.periodSubmissions.title", "Period submissions")}
				/>
			</div>
		);
	}
	if (!data || data.periods.length === 0) return null;
	return (
		<div className="px-4 lg:px-6">
			<PeriodSubmissionsCard periods={data.periods} />
		</div>
	);
}

export async function HistoryRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readHistoryRegion>>;
	try {
		data = await readHistoryRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div className="px-4 lg:px-6">
				<RegionLoadError
					label={t("timeTracking.table.title", "Time Entries")}
				/>
			</div>
		);
	}
	return (
		<div className="px-4 lg:px-6">
			<TimeEntriesTable
				workPeriods={data.workPeriods}
				hasManager={data.hasManager}
				canApproveTimeEntries={data.canApproveTimeEntries}
				employeeTimezone={context.timezone}
				timeFormat={context.timeFormat}
				employeeId={context.employee.id}
			/>
		</div>
	);
}

export async function TimeTrackingPageContent({
	searchParams,
}: {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}): Promise<ReactNode> {
	const context = await getTimeTrackingRenderContext();
	if (!context) {
		const locale = await getLocale();
		const pathname =
			(await headers()).get("x-pathname") || `/${locale}/time-tracking`;
		redirect(
			`/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`,
		);
	}
	if (!context.employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="track time" />
			</div>
		);
	}
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<Suspense fallback={<ClockLoading />}>
				<ClockRegion context={context} />
			</Suspense>
			<Suspense fallback={<TimelineLoading />}>
				<TimelineRegion context={context} searchParams={searchParams} />
			</Suspense>
			<Suspense fallback={<SummaryLoading />}>
				<SummaryRegion context={context} />
			</Suspense>
			<Suspense fallback={<PeriodsLoading />}>
				<PeriodsRegion context={context} />
			</Suspense>
			<Suspense fallback={<HistoryLoading />}>
				<HistoryRegion context={context} />
			</Suspense>
		</div>
	);
}
