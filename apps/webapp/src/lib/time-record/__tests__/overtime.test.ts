import { describe, expect, it } from "vitest";
import { computeOvertimeDelta } from "@/lib/time-record/overtime";

describe("computeOvertimeDelta", () => {
	it("returns positive overtime when actual exceeds expected", () => {
		expect(computeOvertimeDelta({ actualMinutes: 510, expectedMinutes: 480 })).toBe(30);
	});

	it("returns zero when actual matches expected", () => {
		expect(computeOvertimeDelta({ actualMinutes: 480, expectedMinutes: 480 })).toBe(0);
	});

	it("returns zero when actual is lower than expected", () => {
		expect(computeOvertimeDelta({ actualMinutes: 450, expectedMinutes: 480 })).toBe(0);
	});
});
