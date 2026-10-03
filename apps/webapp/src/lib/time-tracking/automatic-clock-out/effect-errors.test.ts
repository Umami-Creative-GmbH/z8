import { expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { checkComplianceAfterClockOut } from "../clock-out-effects";

vi.mock("../compliance-totals", () => ({
	readComplianceTotals: async () => {
		throw new Error("database unavailable");
	},
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
it("propagates compliance failures for durable callers and preserves human best effort", async () => {
	const input = {
		organizationId: "org",
		employeeId: "employee",
		workPeriodId: "period",
		timezone: "UTC",
		work: {
			start: parseInstant("2026-10-24T18:00:00Z"),
			end: parseInstant("2026-10-25T06:00:00Z"),
			durationMinutes: 720,
		},
	};
	await expect(checkComplianceAfterClockOut(input, { throwOnError: true })).rejects.toThrow(
		"database unavailable",
	);
	await expect(checkComplianceAfterClockOut(input)).resolves.toEqual([]);
});
