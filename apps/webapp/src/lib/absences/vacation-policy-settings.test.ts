import { describe, expect, it } from "vitest";
import {
	checkStatutoryMinimumDays,
	defaultStatutoryMinimumDays,
	prorationAppliesToAccrualType,
} from "./vacation-policy-settings";

describe("defaultStatutoryMinimumDays", () => {
	it("caps the statutory minimum at 20 days", () => {
		expect(defaultStatutoryMinimumDays("30")).toBe("20");
		expect(defaultStatutoryMinimumDays("20")).toBe("20");
	});

	it("uses the annual days when a policy grants fewer than 20", () => {
		expect(defaultStatutoryMinimumDays("15")).toBe("15");
		expect(defaultStatutoryMinimumDays("12.5")).toBe("12.5");
	});
});

describe("checkStatutoryMinimumDays", () => {
	it("accepts a statutory minimum from 0 up to the annual days", () => {
		expect(checkStatutoryMinimumDays("0", "30")).toBeNull();
		expect(checkStatutoryMinimumDays("20", "30")).toBeNull();
		expect(checkStatutoryMinimumDays("30", "30")).toBeNull();
		expect(checkStatutoryMinimumDays("12.5", "12.5")).toBeNull();
	});

	it("rejects a negative statutory minimum", () => {
		expect(checkStatutoryMinimumDays("-1", "30")).toBe("negative");
	});

	it("rejects a statutory minimum above the annual days", () => {
		expect(checkStatutoryMinimumDays("31", "30")).toBe("above_annual_days");
		expect(checkStatutoryMinimumDays("20.5", "20")).toBe("above_annual_days");
	});

	it("rejects a value that is not a number", () => {
		expect(checkStatutoryMinimumDays("", "30")).toBe("not_a_number");
		expect(checkStatutoryMinimumDays("abc", "30")).toBe("not_a_number");
	});
});

describe("prorationAppliesToAccrualType", () => {
	it("applies only to policies that grant the allowance all at once", () => {
		expect(prorationAppliesToAccrualType("annual")).toBe(true);
		expect(prorationAppliesToAccrualType("monthly")).toBe(false);
		expect(prorationAppliesToAccrualType("biweekly")).toBe(false);
	});
});
