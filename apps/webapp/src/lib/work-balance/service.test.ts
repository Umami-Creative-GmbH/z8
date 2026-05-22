import { describe, expect, it } from "vitest";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "./format";
import { buildWorkBalanceValues } from "./service";

describe("work balance helpers", () => {
	it("builds all-time work balance values", () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");

		expect(
			buildWorkBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				computedFromDate: "2026-05-01",
				computedThroughDate: "2026-05-22",
				computedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
			updatedAt: computedAt,
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
		});
	});

	it("formats signed all-time work balance values", () => {
		expect(formatSignedWorkBalance(750)).toBe("+12:30h");
		expect(formatSignedWorkBalance(-255)).toBe("-4:15h");
		expect(formatSignedWorkBalance(0)).toBe("0:00h");
	});

	it("classifies positive zero and negative balances", () => {
		expect(getWorkBalanceStatus(1)).toBe("positive");
		expect(getWorkBalanceStatus(0)).toBe("neutral");
		expect(getWorkBalanceStatus(-1)).toBe("negative");
	});
});
