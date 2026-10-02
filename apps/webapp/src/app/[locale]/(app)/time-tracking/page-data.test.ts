import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import {
	getSafeEmployeeWorkBalance,
	getTimeTrackingPageData,
} from "./page-data";
import {
	readActiveWorkPeriod,
	readTimeSummary,
	readWorkPeriods,
} from "./read-queries";
import { getWorkdayTimelineData } from "./workday-timeline-data";

const renderingState = vi.hoisted(() => ({
	context: vi.fn(),
	session: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("./render-context", () => ({
	getTimeTrackingRenderContext: renderingState.context,
}));
vi.mock("@/lib/auth/render-session", () => ({
	getRenderSession: renderingState.session,
}));
vi.mock("next/navigation", () => ({ redirect: renderingState.redirect }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "de") }));

vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({ "x-pathname": "/de/time-tracking?date=2026-10-02" }),
	),
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: vi.fn(async () => null),
}));

vi.mock("@/db/auth-schema", () => ({
	member: {},
}));

vi.mock("@/db/schema", () => ({
	employee: {},
	userSettings: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {},
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	dateToDB: vi.fn((dateTime: DateTime) => dateTime.toJSDate()),
}));

vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	getWeekRangeInTimezone: vi.fn(),
}));

vi.mock("@/lib/user-preferences/time-format", () => ({
	normalizeTimeFormat: vi.fn(),
}));

vi.mock("@/lib/user-preferences/week-start", () => ({
	normalizeWeekStartDay: vi.fn(),
}));

vi.mock("@/lib/work-balance/service", () => ({
	getEmployeeWorkBalance: vi.fn(),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(),
}));

vi.mock("./read-queries", () => ({
	readActiveWorkPeriod: vi.fn(),
	readTimeSummary: vi.fn(),
	readWorkPeriods: vi.fn(),
}));

vi.mock("./actions/auth", () => ({
	getCurrentEmployee: vi.fn(() => {
		throw new Error("Render must not authenticate again");
	}),
}));

vi.mock("./workday-timeline-data", () => ({
	getWorkdayTimelineData: vi.fn(),
}));

const balanceRequest = {
	employeeId: "employee-1",
	organizationId: "org-1",
};

describe("getTimeTrackingPageData authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		renderingState.context.mockResolvedValue(null);
		renderingState.session.mockResolvedValue(null);
	});

	it("uses the session-expired redirect before loading protected data", async () => {
		await expect(getTimeTrackingPageData()).rejects.toThrow(
			"redirect:/api/auth/session-expired?locale=de&callbackUrl=%2Fde%2Ftime-tracking%3Fdate%3D2026-10-02",
		);
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
		expect(readWorkPeriods).not.toHaveBeenCalled();
		expect(readTimeSummary).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
		expect(getEmployeeWorkBalance).not.toHaveBeenCalled();
	});

	it("preserves the no-employee result without reading protected data", async () => {
		renderingState.context.mockResolvedValue({
			userId: "user-1",
			employeeName: "Test Employee",
			employee: null,
			membershipRole: null,
			timezone: "UTC",
			weekStartDay: "sunday",
			timeFormat: "24h",
		});
		renderingState.session.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		await expect(getTimeTrackingPageData()).resolves.toMatchObject({
			currentEmployee: null,
		});
		expect(renderingState.redirect).not.toHaveBeenCalled();
		expect(readActiveWorkPeriod).not.toHaveBeenCalled();
		expect(readWorkPeriods).not.toHaveBeenCalled();
		expect(readTimeSummary).not.toHaveBeenCalled();
		expect(getWorkdayTimelineData).not.toHaveBeenCalled();
		expect(getEmployeeWorkBalance).not.toHaveBeenCalled();
	});

	it.each([
		["owner", true],
		["admin", true],
		["employee", false],
	])(
		"uses the approved %s role for page approval capability",
		async (role, expected) => {
			renderingState.context.mockResolvedValue({
				userId: "user-1",
				employeeName: "Test Employee",
				employee: { id: "employee-1", organizationId: "org-1" },
				membershipRole: role,
				timezone: "UTC",
				weekStartDay: "sunday",
				timeFormat: "24h",
			});
			renderingState.session.mockResolvedValue({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			});
			vi.mocked(getWorkdayTimelineData).mockResolvedValue({
				success: false,
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
			});
			const { getWeekRangeInTimezone } = await import(
				"@/lib/time-tracking/timezone-utils"
			);
			vi.mocked(getWeekRangeInTimezone).mockReturnValue({
				start: DateTime.utc(2026, 9, 27),
				end: DateTime.utc(2026, 10, 3),
			});
			vi.mocked(readWorkPeriods).mockResolvedValue([
				{ id: "history-period" },
			] as Awaited<ReturnType<typeof readWorkPeriods>>);
			vi.mocked(readTimeSummary).mockResolvedValue({
				todayMinutes: 60,
				weekMinutes: 60,
				monthMinutes: 60,
			});
			await expect(getTimeTrackingPageData()).resolves.toMatchObject({
				currentEmployee: { id: "employee-1", organizationId: "org-1" },
				canApproveTimeEntries: expected,
				workPeriods: [{ id: "history-period" }],
				summary: { todayMinutes: 60, weekMinutes: 60, monthMinutes: 60 },
			});
			expect(readActiveWorkPeriod).toHaveBeenCalledWith(balanceRequest);
			expect(readTimeSummary).toHaveBeenCalledWith(
				balanceRequest,
				"UTC",
				"sunday",
			);
			expect(readWorkPeriods).toHaveBeenCalledWith(
				balanceRequest,
				new Date("2026-09-27T00:00:00Z"),
				new Date("2026-10-03T00:00:00Z"),
			);
		},
	);
});

describe("getSafeEmployeeWorkBalance", () => {
	beforeEach(() => {
		vi.mocked(getEmployeeWorkBalance).mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("returns null and logs when work balance loading fails", async () => {
		const error = new Error("balance failed");
		vi.mocked(getEmployeeWorkBalance).mockRejectedValue(error);

		await expect(
			getSafeEmployeeWorkBalance(balanceRequest),
		).resolves.toBeNull();

		expect(console.error).toHaveBeenCalledWith(
			"Failed to load employee work balance",
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				error,
			},
		);
	});
});
