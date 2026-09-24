import { describe, expect, it, vi } from "vitest";
import {
	assertNoOpenDepartureClockRepairs,
	PayrollOffboardingRepairBlockedError,
} from "./offboarding-repair-guard";

const range = {
	start: new Date("2026-08-31T12:00:00Z"),
	endExclusive: new Date("2026-10-01T12:00:00Z"),
};

describe("assertNoOpenDepartureClockRepairs", () => {
	it("blocks the whole export while a departure timer repair is open", async () => {
		const findRepairs = vi.fn().mockResolvedValue([
			{
				reviewId: "review-1",
				employeeId: "employee-1",
				workPeriodId: "period-1",
				affectedStartAt: null,
				affectedEndAt: new Date("2026-09-14T22:00:00Z"),
			},
		]);

		const result = assertNoOpenDepartureClockRepairs({
			organizationId: "org-1",
			employeeIds: ["employee-1", "employee-2"],
			range,
			findRepairs,
		});

		await expect(result).rejects.toBeInstanceOf(PayrollOffboardingRepairBlockedError);
		await expect(result).rejects.toMatchObject({ employeeIds: ["employee-1"] });
		expect(findRepairs).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["employee-1", "employee-2"],
			rangeStart: range.start,
			rangeEndExclusive: range.endExclusive,
		});
	});

	it("lets the export continue without open repairs", async () => {
		await expect(
			assertNoOpenDepartureClockRepairs({
				organizationId: "org-1",
				employeeIds: ["employee-1"],
				range,
				findRepairs: vi.fn().mockResolvedValue([]),
			}),
		).resolves.toBeUndefined();
	});
});
