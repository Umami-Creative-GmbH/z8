import "server-only";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { ContractorStatementExport } from "@/components/contractor-statements/contractor-statement-export";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockDayTotal } from "@/components/time-tracking/clock-day-total";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { DrivingDetailsMissingNotice } from "@/components/time-tracking/driving-details-missing-notice";
import { PeriodBlockerFocus } from "@/components/time-tracking/period-blocker-focus";
import { PeriodSubmissionsCard } from "@/components/time-tracking/period-submissions-card";
import { PersonalWorkdayTimeline } from "@/components/time-tracking/personal-workday-timeline";
import { SessionReminders } from "@/components/time-tracking/session-reminders";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { TimeTrackingPageActions } from "@/components/time-tracking/time-tracking-page-actions";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { WorkdayMonthPicker } from "@/components/time-tracking/workday-date-navigation";
import { WorkplacePolicyContext } from "@/components/time-tracking/workplace-policy-context";
import {
	CLOCK_FOCUS_TARGET_ID,
	CLOCK_REGION_ID,
	TIMELINE_REGION_ID,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import { getTranslate } from "@/tolgee/server";
import { getPresenceStatus } from "./actions";
import type { TimeTrackingPageSearchParams } from "./page-data";
import { readActiveWorkPeriod } from "./read-queries";
import {
	readContractorStatementRegion,
	readDrivingRegion,
	readHistoryRegion,
	readPeriodsRegion,
	readSummaryRegion,
} from "./region-data";
import {
	ClockLoading,
	DrivingLoading,
	HistoryLoading,
	PeriodsLoading,
	RegionLoadError,
	SummaryLoading,
	TimelineLoading,
} from "./region-fallbacks";
import { type EmployeeRenderContext, getTimeTrackingRenderContext } from "./render-context";
import { serializeWorkdayTimelineResult } from "./timeline-serialization";
import { getWorkdayTimelineData } from "./workday-timeline-data";
import { getSelectedWorkdayDate } from "./workday-timeline-date";

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
		employeeName = context.employeeName || (await getTranslate())("common.employee", "Employee");
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			// Rendered, if without the clock: a live-work focus stops waiting for it (#1302).
			<div id={CLOCK_REGION_ID}>
				<RegionLoadError label={t("timeTracking.title", "Time Tracking")} />
			</div>
		);
	}
	return (
		// The focus target of a live-work period blocker link (#1349); focusing never clocks out.
		<div
			id={CLOCK_FOCUS_TARGET_ID}
			tabIndex={-1}
			className="scroll-mt-4 outline-none focus:*:ring-2 focus:*:ring-ring"
		>
			<ClockInOutWidget
				activeWorkPeriod={activeWorkPeriod}
				employeeName={employeeName}
				timeFormat={context.timeFormat}
				daySummary={
					<Suspense fallback={null}>
						<ClockDayTotalRegion context={context} />
					</Suspense>
				}
			/>
		</div>
	);
}

async function ClockDayTotalRegion({ context }: { context: EmployeeRenderContext }) {
	let data: Awaited<ReturnType<typeof readSummaryRegion>>;
	try {
		data = await readSummaryRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		return null;
	}
	return <ClockDayTotal data={data.kpis} />;
}

/**
 * The employee's work showing driving details missing (#1127). Nothing while there is none, or
 * while it cannot be read: the notice is a reminder, never a reason to fail the page.
 */
export async function DrivingRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readDrivingRegion>>;
	try {
		data = await readDrivingRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		return null;
	}
	if (data.work.length === 0) return null;
	return (
		<div>
			<DrivingDetailsMissingNotice
				work={data.work}
				employeeId={context.employee.id}
				timeFormat={context.timeFormat}
				truncated={data.truncated}
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
		const [{ date }, locale] = await Promise.all([searchParams, getLocale()]);
		result = await getWorkdayTimelineData({
			employeeId: context.employee.id,
			organizationId: context.employee.organizationId,
			timezone: context.timezone,
			locale,
			timeFormat: context.timeFormat,
			dateParam: date,
		});
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div id={TIMELINE_REGION_ID}>
				<RegionLoadError label={t("timeTracking.timeline.title", "Workday timeline")} />
			</div>
		);
	}
	return (
		// Once rendered, a period blocker focus waits only briefly for its row (#1302).
		<div id={TIMELINE_REGION_ID}>
			<PersonalWorkdayTimeline
				result={serializeWorkdayTimelineResult(result)}
				weekStartDay={context.weekStartDay}
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
			<div>
				<RegionLoadError label={t("timeTracking.summary.thisWeek", "This Week")} />
			</div>
		);
	}
	return <WeeklySummaryCards kpis={data.kpis} workBalance={data.workBalance} />;
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
			<div>
				<RegionLoadError label={t("timeTracking.periodSubmissions.title", "Period submissions")} />
			</div>
		);
	}
	if (!data || data.periods.length === 0) return null;
	return (
		<div>
			<PeriodSubmissionsCard
				periods={data.periods}
				organizationId={context.employee.organizationId}
				employeeId={context.employee.id}
			/>
		</div>
	);
}

/**
 * An External Contractor's own Time & Fee Statement (#2000): shown only to people with a
 * contractor engagement, and nothing when that cannot be read; never a reason to fail the page.
 */
export async function ContractorStatementRegion({
	context,
}: {
	context: EmployeeRenderContext;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readContractorStatementRegion>>;
	try {
		data = await readContractorStatementRegion(context);
	} catch (error) {
		unstable_rethrow(error);
		return null;
	}
	if (!data) return null;
	return (
		<div>
			<ContractorStatementExport
				employeeId={context.employee.id}
				audience="self"
				today={data.today}
			/>
		</div>
	);
}

export async function HistoryRegion({
	context,
	searchParams,
}: {
	context: EmployeeRenderContext;
	searchParams?: Promise<TimeTrackingPageSearchParams>;
}): Promise<ReactNode> {
	let data: Awaited<ReturnType<typeof readHistoryRegion>>;
	try {
		const { date } = (await searchParams) ?? {};
		const selected = getSelectedWorkdayDate({
			dateParam: typeof date === "string" ? date : undefined,
			timezone: context.timezone,
		});
		data = await readHistoryRegion(context, selected.dateKey);
	} catch (error) {
		unstable_rethrow(error);
		const t = await getTranslate();
		return (
			<div>
				<RegionLoadError label={t("timeTracking.table.title", "Time Entries")} />
			</div>
		);
	}
	return (
		<div>
			<TimeEntriesTable
				workPeriods={data.workPeriods}
				drivingDetailsMissingIds={data.drivingDetailsMissingIds}
				hasManager={data.hasManager}
				canApproveTimeEntries={data.canApproveTimeEntries}
				employeeTimezone={context.timezone}
				timeFormat={context.timeFormat}
				employeeId={context.employee.id}
			/>
		</div>
	);
}

/** Focuses the work a period blocker link opened, or explains why it cannot (#1349). */
export async function PeriodBlockerFocusRegion({
	context,
	searchParams,
}: {
	context: EmployeeRenderContext;
	searchParams: Promise<TimeTrackingPageSearchParams>;
}): Promise<ReactNode> {
	const { focus } = await searchParams;
	return (
		<PeriodBlockerFocus
			organizationId={context.employee.organizationId}
			employeeId={context.employee.id}
			focus={typeof focus === "string" ? focus : undefined}
		/>
	);
}

export async function WorkdayContextRegion({
	context,
	searchParams,
}: {
	context: EmployeeRenderContext;
	searchParams: Promise<TimeTrackingPageSearchParams>;
}) {
	const { date } = await searchParams;
	const selectedDate = getSelectedWorkdayDate({
		dateParam: typeof date === "string" ? date : undefined,
		timezone: context.timezone,
	});
	return (
		<WorkdayMonthPicker
			key={selectedDate.dateKey}
			dateKey={selectedDate.dateKey}
			todayDateKey={selectedDate.todayDateKey}
			weekStartDay={context.weekStartDay}
		/>
	);
}

export async function WorkplacePolicyRegion({ context }: { context: EmployeeRenderContext }) {
	let result: Awaited<ReturnType<typeof getPresenceStatus>>;
	try {
		result = await getPresenceStatus(context.employee.id);
	} catch (error) {
		unstable_rethrow(error);
		return null;
	}
	return result.success ? <WorkplacePolicyContext status={result.data} /> : null;
}

export async function TimeTrackingPageContent({
	searchParams,
}: {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}): Promise<ReactNode> {
	const context = await getTimeTrackingRenderContext();
	if (!context) {
		const locale = await getLocale();
		const pathname = (await headers()).get("x-pathname") || `/${locale}/time-tracking`;
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
	const t = await getTranslate();
	return (
		<div
			data-testid="time-tracking-content"
			className="@container/main page-frame flex flex-1 flex-col gap-6"
		>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="space-y-2">
					<p className="text-sm text-muted-foreground">{context.employeeName}</p>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("timeTracking.title", "Time Tracking")}
					</h1>
				</div>
				<TimeTrackingPageActions employeeId={context.employee.id} timezone={context.timezone} />
			</div>
			<Suspense fallback={null}>
				<PeriodBlockerFocusRegion context={context} searchParams={searchParams} />
			</Suspense>
			<Suspense fallback={<ClockLoading />}>
				<ClockRegion context={context} />
			</Suspense>
			<Suspense fallback={<DrivingLoading />}>
				<DrivingRegion context={context} />
			</Suspense>
			{/* The totals answer "how much so far" beside the clock; the timeline details one day. */}
			<Suspense fallback={<SummaryLoading />}>
				<SummaryRegion context={context} />
			</Suspense>
			<div className="grid min-w-0 gap-6 @5xl/main:grid-cols-[minmax(0,1fr)_19rem]">
				<div className="min-w-0 space-y-6">
					<Suspense fallback={<TimelineLoading />}>
						<TimelineRegion context={context} searchParams={searchParams} />
					</Suspense>
					<Suspense fallback={<HistoryLoading />}>
						<HistoryRegion context={context} searchParams={searchParams} />
					</Suspense>
					<Suspense fallback={<PeriodsLoading />}>
						<PeriodsRegion context={context} />
					</Suspense>
					<Suspense fallback={null}>
						<ContractorStatementRegion context={context} />
					</Suspense>
				</div>
				<aside className="min-w-0 space-y-6">
					<SessionReminders />
					<Suspense fallback={null}>
						<WorkdayContextRegion context={context} searchParams={searchParams} />
					</Suspense>
					<Suspense fallback={null}>
						<WorkplacePolicyRegion context={context} />
					</Suspense>
				</aside>
			</div>
		</div>
	);
}
