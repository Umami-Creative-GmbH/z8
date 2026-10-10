// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { type ReactElement, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	ClockRegion,
	HistoryRegion,
	PeriodsRegion,
	SummaryRegion,
	TimelineRegion,
	TimeTrackingPageContent,
} from "./regions";
import {
	type EmployeeRenderContext,
	getTimeTrackingRenderContext,
} from "./render-context";
import { serializeWorkdayTimelineResult } from "./timeline-serialization";
import { getWorkdayTimelineData } from "./workday-timeline-data";

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/navigation")>()),
	unstable_rethrow: vi.fn(
		(await importOriginal<typeof import("next/navigation")>()).unstable_rethrow,
	),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: state.refresh }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({ "x-pathname": "/de/time-tracking?date=2026-10-02" }),
	),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "de") }));
vi.mock("./render-context", () => ({ getTimeTrackingRenderContext: vi.fn() }));
vi.mock("./read-queries", () => ({ readActiveWorkPeriod: vi.fn() }));
vi.mock("./region-data", () => ({
	readHistoryRegion: vi.fn(),
	readPeriodsRegion: vi.fn(),
	readSummaryRegion: vi.fn(),
}));
vi.mock("@/components/time-tracking/period-submissions-card", () => ({
	PeriodSubmissionsCard: () => null,
}));
vi.mock("./workday-timeline-data", () => ({ getWorkdayTimelineData: vi.fn() }));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => null,
}));
vi.mock("@/components/time-tracking/clock-in-out-widget", () => ({
	ClockInOutWidget: () => null,
}));
vi.mock("@/components/time-tracking/personal-workday-timeline", () => ({
	PersonalWorkdayTimeline: () => null,
}));
vi.mock("@/components/time-tracking/time-entries-table", () => ({
	TimeEntriesTable: () => null,
}));
vi.mock("@/components/time-tracking/weekly-summary-cards", () => ({
	WeeklySummaryCards: () => null,
}));

const context = {
	userId: "user-1",
	employeeName: "Test Employee",
	employee: { id: "employee-1", organizationId: "org-1" },
	membershipRole: "admin",
	timezone: "Europe/Berlin",
	weekStartDay: "monday",
	timeFormat: "24h",
} as EmployeeRenderContext;
const activePeriod = {
	id: "active-1",
	startTime: new Date("2026-10-02T08:00:00Z"),
} as NonNullable<Awaited<ReturnType<typeof readActiveWorkPeriod>>>;
const summaryData = {
	summary: { todayMinutes: 60, weekMinutes: 120, monthMinutes: 180 },
	workBalance: null,
};
const historyData = {
	workPeriods: [],
	hasManager: true,
	canApproveTimeEntries: true,
};
const timelineResult = {
	success: false as const,
	selectedDate: {
		dateKey: "2026-10-02",
		todayDateKey: "2026-10-02",
		previousDateKey: "2026-10-01",
		nextDateKey: "2026-10-03",
		label: "October 2",
		startUtc: DateTime.utc(2026, 10, 2),
		endUtc: DateTime.utc(2026, 10, 3),
	},
	error: "Timeline unavailable",
};
const searchParams = () => Promise.resolve({ date: "2026-10-02" });
const element = (node: unknown) =>
	node as ReactElement<Record<string, unknown>>;
const leaf = (node: unknown) => {
	const result = element(node);
	return result.type === "div" ? element(result.props.children) : result;
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getTimeTrackingRenderContext).mockResolvedValue(context);
	vi.mocked(readActiveWorkPeriod).mockResolvedValue(activePeriod);
	vi.mocked(readSummaryRegion).mockResolvedValue(summaryData);
	vi.mocked(readHistoryRegion).mockResolvedValue(historyData);
	vi.mocked(getWorkdayTimelineData).mockResolvedValue(timelineResult);
});

describe("independent time tracking region components", () => {
	it("clock resolves while secondary regions and search params are pending", async () => {
		const identity = Promise.withResolvers<EmployeeRenderContext>();
		const active =
			Promise.withResolvers<Awaited<ReturnType<typeof readActiveWorkPeriod>>>();
		const summary = Promise.withResolvers<typeof summaryData>();
		const history = Promise.withResolvers<typeof historyData>();
		const timeline = Promise.withResolvers<typeof timelineResult>();
		const date = Promise.withResolvers<TimeTrackingPageSearchParams>();
		let secondarySettled = false;
		vi.mocked(readActiveWorkPeriod).mockReturnValue(active.promise);
		vi.mocked(readSummaryRegion).mockReturnValue(summary.promise);
		vi.mocked(readHistoryRegion).mockReturnValue(history.promise);
		vi.mocked(getWorkdayTimelineData).mockReturnValue(timeline.promise);
		const clock = identity.promise.then((context) => ClockRegion({ context }));
		identity.resolve(context);
		void Promise.all([
			SummaryRegion({ context }),
			HistoryRegion({ context }),
			TimelineRegion({ context, searchParams: date.promise }),
		]).then(() => {
			secondarySettled = true;
		});
		active.resolve(activePeriod);
		const clockElement = leaf(await clock);
		expect(clockElement.type).toBe(ClockInOutWidget);
		expect(clockElement.props.activeWorkPeriod).toEqual(activePeriod);
		expect(clockElement.props.employeeName).toBe("Test Employee");
		expect(clockElement.props.timeFormat).toBe("24h");
		expect(secondarySettled).toBe(false);
		expect(getTranslate).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
		date.resolve({ date: "2026-10-02" });
		summary.resolve(summaryData);
		history.resolve(historyData);
		timeline.resolve(timelineResult);
	});

	it("page returns independent boundaries without resolving secondary data", async () => {
		const identity = Promise.withResolvers<EmployeeRenderContext>();
		const date = Promise.withResolvers<TimeTrackingPageSearchParams>();
		vi.mocked(getTimeTrackingRenderContext).mockReturnValue(identity.promise);
		const result = TimeTrackingPageContent({ searchParams: date.promise });
		identity.resolve(context);
		const content = element(await result);
		expect(content.props.className).toBe(
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		);
		const boundaries = content.props.children as ReactElement<{
			children: ReactElement<{
				context: EmployeeRenderContext;
				searchParams?: Promise<TimeTrackingPageSearchParams>;
			}>;
			fallback: ReactElement;
		}>[];
		expect(boundaries).toHaveLength(5);
		expect(boundaries.map((boundary) => boundary.type)).toEqual([
			Suspense,
			Suspense,
			Suspense,
			Suspense,
			Suspense,
		]);
		expect(boundaries.map((boundary) => boundary.props.children.type)).toEqual([
			ClockRegion,
			TimelineRegion,
			SummaryRegion,
			PeriodsRegion,
			HistoryRegion,
		]);
		expect(boundaries.map((boundary) => boundary.props.fallback.type)).toEqual([
			ClockLoading,
			TimelineLoading,
			SummaryLoading,
			PeriodsLoading,
			HistoryLoading,
		]);
		expect(
			boundaries.map((boundary) => boundary.props.children.props.context),
		).toEqual([context, context, context, context, context]);
		expect(
			boundaries.map((boundary) => boundary.props.children.props.searchParams),
		).toEqual([undefined, date.promise, undefined, undefined, undefined]);
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
		expect(readSummaryRegion).not.toHaveBeenCalled();
		expect(readHistoryRegion).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
	});

	it("keeps the translated employee label and known clocked-out status", async () => {
		vi.mocked(readActiveWorkPeriod).mockResolvedValue(null);
		const result = leaf(
			await ClockRegion({ context: { ...context, employeeName: "" } }),
		);
		expect(result.props).toMatchObject({
			activeWorkPeriod: null,
			employeeName: "Employee",
			timeFormat: "24h",
		});
		expect(getTranslate).toHaveBeenCalledTimes(1);
		expect(readActiveWorkPeriod).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
		});
	});

	it("serializes structured timeline failures and scopes the selected date locally", async () => {
		const result = leaf(
			await TimelineRegion({ context, searchParams: searchParams() }),
		);
		expect(result.type).toBe(PersonalWorkdayTimeline);
		expect(result.props.result).toEqual(
			serializeWorkdayTimelineResult(timelineResult),
		);
		expect(getWorkdayTimelineData).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "Europe/Berlin",
			timeFormat: "24h",
			dateParam: "2026-10-02",
		});
	});

	it("preserves summary balance-null semantics and history leaf props", async () => {
		expect(element(await SummaryRegion({ context })).props).toEqual(
			summaryData,
		);
		const history = leaf(await HistoryRegion({ context }));
		expect(history.type).toBe(TimeEntriesTable);
		expect(history.props).toEqual({
			...historyData,
			employeeTimezone: "Europe/Berlin",
			timeFormat: "24h",
			employeeId: "employee-1",
		});
	});

	it("shows the period view only where the organization collects period submissions", async () => {
		vi.mocked(readPeriodsRegion).mockResolvedValue(null);
		expect(await PeriodsRegion({ context })).toBeNull();
		const periods = [
			{
				startDate: "2026-03-02",
				endDate: "2026-03-08",
				status: "awaiting_submission" as const,
				rejectionReason: null,
				submittedAt: null,
				canSubmit: true,
				opensOn: "2026-03-08",
			},
		];
		vi.mocked(readPeriodsRegion).mockResolvedValue({ timezone: "Europe/Berlin", periods });
		const view = leaf(await PeriodsRegion({ context }));
		expect(view.type).toBe(PeriodSubmissionsCard);
		expect(view.props).toEqual({ periods });
	});

	const regions = [
		{
			name: "clock",
			read: readActiveWorkPeriod,
			run: () => ClockRegion({ context }),
		},
		{
			name: "summary",
			read: readSummaryRegion,
			run: () => SummaryRegion({ context }),
		},
		{
			name: "periods",
			read: readPeriodsRegion,
			run: () => PeriodsRegion({ context }),
		},
		{
			name: "history",
			read: readHistoryRegion,
			run: () => HistoryRegion({ context }),
		},
		{
			name: "timeline",
			read: getWorkdayTimelineData,
			run: () => TimelineRegion({ context, searchParams: searchParams() }),
		},
	];
	it.each(regions)(
		"isolates ordinary $name failure without returning unknown clock status",
		async ({ read, run }) => {
			const error = new Error("private database detail");
			vi.mocked(read).mockRejectedValue(error);
			const result = leaf(await run());
			expect(unstable_rethrow).toHaveBeenCalledWith(error);
			expect(result.type).toBe(RegionLoadError);
			expect(result.props).not.toHaveProperty("activeWorkPeriod");
			expect(JSON.stringify(result.props)).not.toContain(error.message);
		},
	);
	it("leaves completed siblings usable when history fails", async () => {
		vi.mocked(readHistoryRegion).mockRejectedValue(new Error("history failed"));
		const [clock, summary, history, timeline] = await Promise.all([
			ClockRegion({ context }),
			SummaryRegion({ context }),
			HistoryRegion({ context }),
			TimelineRegion({ context, searchParams: searchParams() }),
		]);
		expect(
			[clock, summary, history, timeline].map((result) => leaf(result).type),
		).toEqual([
			ClockInOutWidget,
			WeeklySummaryCards,
			RegionLoadError,
			PersonalWorkdayTimeline,
		]);
	});

	it.each(regions)(
		"rethrows Next control flow before $name fallback",
		async ({ read, run }) => {
			for (const control of [
				() => redirect("/sign-in"),
				() => notFound(),
				() => {
					throw new DynamicServerError("prerender");
				},
			]) {
				let error: unknown;
				try {
					control();
				} catch (caught) {
					error = caught;
				}
				vi.mocked(read).mockRejectedValue(error);
				await expect(run()).rejects.toBe(error);
				expect(unstable_rethrow).toHaveBeenCalledWith(error);
			}
			const abort = new AbortController();
			const hanging = makeUntrackedHangingPromise(
				abort.signal,
				"/time-tracking",
				"test",
			);
			abort.abort();
			const error = await hanging.catch((caught: unknown) => caught);
			vi.mocked(read).mockRejectedValue(error);
			await expect(run()).rejects.toBe(error);
		},
	);

	it("denies unknown auth before protected reads or content", async () => {
		vi.mocked(getTimeTrackingRenderContext).mockResolvedValue(null);
		await expect(
			TimeTrackingPageContent({
				searchParams:
					Promise.withResolvers<TimeTrackingPageSearchParams>().promise,
			}),
		).rejects.toMatchObject({
			digest: expect.stringContaining(
				"/api/auth/session-expired?locale=de&callbackUrl=%2Fde%2Ftime-tracking%3Fdate%3D2026-10-02",
			),
		});
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
		expect(readSummaryRegion).not.toHaveBeenCalled();
		expect(readHistoryRegion).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
	});
	it("lets authorization failures escape before protected reads", async () => {
		const error = new Error("authorization unavailable");
		vi.mocked(getTimeTrackingRenderContext).mockRejectedValue(error);
		await expect(
			TimeTrackingPageContent({ searchParams: searchParams() }),
		).rejects.toBe(error);
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
	});
	it("returns the existing no employee error without protected regions", async () => {
		vi.mocked(getTimeTrackingRenderContext).mockResolvedValue({
			...context,
			employee: null,
			membershipRole: null,
		});
		const result = element(
			await TimeTrackingPageContent({ searchParams: searchParams() }),
		);
		expect(element(result.props.children).type).toBe(NoEmployeeError);
		expect(element(result.props.children).props.feature).toBe("track time");
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
		expect(readSummaryRegion).not.toHaveBeenCalled();
		expect(readHistoryRegion).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
	});

	it.each([
		{ Loading: ClockLoading, height: "h-40", count: 1 },
		{ Loading: TimelineLoading, height: "h-64", count: 1 },
		{ Loading: SummaryLoading, height: "h-28", count: 4 },
		{ Loading: HistoryLoading, height: "h-80", count: 1 },
	])(
		"keeps accessible $height loading geometry",
		({ Loading, height, count }) => {
			const { container } = render(<Loading />);
			expect(screen.getByRole("status", { name: "Loading..." })).toBeTruthy();
			expect(container.querySelectorAll(`.${height}`)).toHaveLength(count);
		},
	);

	it("retry refreshes once without enabling clock actions locally", () => {
		render(<RegionLoadError label="Time Tracking" />);
		expect(screen.getByRole("alert").textContent).toContain("Time Tracking");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(state.refresh).toHaveBeenCalledTimes(1);
		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByRole("alert").textContent).toContain(
			"An error occurred",
		);
	});
});
