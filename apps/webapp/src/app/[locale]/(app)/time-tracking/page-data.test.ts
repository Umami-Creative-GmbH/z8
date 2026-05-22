import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import { getSafeEmployeeWorkBalance } from "./page-data";

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {},
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
	dateToDB: vi.fn(),
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

vi.mock("./actions", () => ({
	getActiveWorkPeriod: vi.fn(),
	getTimeSummary: vi.fn(),
	getWorkPeriods: vi.fn(),
}));

vi.mock("./workday-timeline-data", () => ({
	getWorkdayTimelineData: vi.fn(),
}));

const balanceRequest = {
	employeeId: "employee-1",
	organizationId: "org-1",
};

describe("getSafeEmployeeWorkBalance", () => {
	beforeEach(() => {
		vi.mocked(getEmployeeWorkBalance).mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("returns null and logs when work balance loading fails", async () => {
		const error = new Error("balance failed");
		vi.mocked(getEmployeeWorkBalance).mockRejectedValue(error);

		await expect(getSafeEmployeeWorkBalance(balanceRequest)).resolves.toBeNull();

		expect(console.error).toHaveBeenCalledWith("Failed to load employee work balance", {
			employeeId: "employee-1",
			organizationId: "org-1",
			error,
		});
	});
});
