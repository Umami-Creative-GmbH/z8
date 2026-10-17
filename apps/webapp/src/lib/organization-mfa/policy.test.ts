import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { assignEnrollmentWindow, hasRecentVerification } from "./policy";

describe("organization MFA policy windows", () => {
	it("assigns exact elapsed days across DST, retaining the first assignment", () => {
		const window = assignEnrollmentWindow({
			startsAt: "2026-10-24T01:30:00Z",
			gracePeriodDays: 7,
		});
		expect(window.deadline).toBe("2026-10-31T01:30:00Z");
		expect(
			assignEnrollmentWindow(
				{ startsAt: "2026-11-01T00:00:00Z", gracePeriodDays: 30 },
				window,
			),
		).toBe(window);
	});
	it("rejects unsupported windows", () => {
		expect(() =>
			assignEnrollmentWindow({
				startsAt: "2026-10-24T01:30:00Z",
				gracePeriodDays: 1,
			}),
		).toThrow();
	});
	it("requires a verification in the past five minutes, excluding future evidence", () => {
		const now = Temporal.Instant.from("2026-10-17T09:00:00Z");
		expect(hasRecentVerification("2026-10-17T08:55:00Z", now)).toBe(true);
		expect(hasRecentVerification("2026-10-17T08:54:59.999Z", now)).toBe(false);
		expect(hasRecentVerification("2026-10-17T09:00:00.001Z", now)).toBe(false);
	});
});
