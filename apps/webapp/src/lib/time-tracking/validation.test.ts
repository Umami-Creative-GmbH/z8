import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	isHolidayBlockingTimeEntry: vi.fn(),
}));

vi.mock("@/lib/calendar/holiday-service", () => ({
	isHolidayBlockingTimeEntry: state.isHolidayBlockingTimeEntry,
}));

const { validateTimeEntryRange } = await import("./validation");

describe("validateTimeEntryRange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.isHolidayBlockingTimeEntry.mockResolvedValue({
			isBlocked: false,
			holiday: null,
		});
	});

	it("checks every employee-local date when a short range crosses midnight near UTC midnight", async () => {
		await validateTimeEntryRange(
			"org-1",
			new Date("2026-01-02T07:30:00.000Z"),
			new Date("2026-01-02T09:00:00.000Z"),
			"America/Los_Angeles",
		);

		expect(state.isHolidayBlockingTimeEntry).toHaveBeenCalledTimes(2);
		expect(
			state.isHolidayBlockingTimeEntry.mock.calls.map(([, date, timezone]) => [
				(date as Date).toISOString(),
				timezone,
			]),
		).toEqual([
			["2026-01-02T07:30:00.000Z", "America/Los_Angeles"],
			["2026-01-02T08:00:00.000Z", "America/Los_Angeles"],
		]);
	});

	it("rejects an extreme range before checking any holidays", async () => {
		await expect(
			validateTimeEntryRange(
				"org-1",
				new Date("0001-01-01T00:00:00.000Z"),
				new Date("2026-01-01T00:00:00.000Z"),
				"UTC",
			),
		).resolves.toEqual({
			isValid: false,
			error: "Work period cannot exceed 24 hours",
		});
		expect(state.isHolidayBlockingTimeEntry).not.toHaveBeenCalled();
	});

	it("accepts the exact cap and checks local dates sequentially", async () => {
		let activeChecks = 0;
		let maximumConcurrentChecks = 0;
		state.isHolidayBlockingTimeEntry.mockImplementation(async () => {
			activeChecks += 1;
			maximumConcurrentChecks = Math.max(maximumConcurrentChecks, activeChecks);
			await new Promise((resolve) => setTimeout(resolve, 1));
			activeChecks -= 1;
			return { isBlocked: false, holiday: null };
		});

		await expect(
			validateTimeEntryRange(
				"org-1",
				new Date("2026-01-01T12:00:00.000Z"),
				new Date("2026-01-02T12:00:00.000Z"),
				"Europe/Berlin",
			),
		).resolves.toEqual({ isValid: true });

		expect(state.isHolidayBlockingTimeEntry).toHaveBeenCalledTimes(2);
		expect(maximumConcurrentChecks).toBe(1);
	});

	it.each([
		["cross-midnight", "2026-01-02T22:30:00.000Z", "2026-01-03T00:30:00.000Z"],
		[
			"DST spring-forward",
			"2026-03-29T00:30:00.000Z",
			"2026-03-29T02:30:00.000Z",
		],
	])("accepts a valid %s period", async (_label, start, end) => {
		await expect(
			validateTimeEntryRange(
				"org-1",
				new Date(start),
				new Date(end),
				"Europe/Berlin",
			),
		).resolves.toEqual({ isValid: true });
	});
});
