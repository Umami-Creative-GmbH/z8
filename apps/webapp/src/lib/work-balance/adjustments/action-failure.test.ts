import { describe, expect, it } from "vitest";
import { balanceAdjustmentFailureOf } from "./types";

describe("balanceAdjustmentFailureOf (#1613)", () => {
	it("reads a refusal's own code and details", () => {
		const conflictingPayouts = [{ id: "p1", day: "2026-05-04", minutes: -60 }];
		expect(
			balanceAdjustmentFailureOf({
				success: false,
				error: "Payouts conflict",
				code: "ValidationError",
				refusal: "conflicting_payouts",
				details: { conflictingPayouts },
			}),
		).toEqual({ code: "conflicting_payouts", details: { conflictingPayouts } });
	});

	it.each([
		["AuthorizationError", "not_permitted"],
		["AuthenticationError", "not_permitted"],
		["ValidationError", "invalid_input"],
		["DatabaseError", "failed"],
	] as const)("maps %s to %s", (code, expected) => {
		expect(balanceAdjustmentFailureOf({ success: false, error: "x", code }).code).toBe(expected);
	});

	it("keeps a closed month's month", () => {
		expect(
			balanceAdjustmentFailureOf({
				success: false,
				error: "Closed",
				code: "MonthClosedError",
				closedMonth: "2026-04",
			}),
		).toEqual({ code: "month_closed", details: { closedMonth: "2026-04" } });
	});
});
