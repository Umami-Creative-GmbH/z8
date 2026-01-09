/**
 * Tests for the getTimeAgo utility function
 * These are pure function tests - no mocking required
 */

import { describe, expect, it } from "bun:test";
import { getTimeAgo } from "../notification-service";
import {
	dateDaysAgo,
	dateHoursAgo,
	dateMinutesAgo,
	dateMonthsAgo,
	dateSecondsAgo,
	dateWeeksAgo,
} from "./helpers";

describe("getTimeAgo", () => {
	describe("just now (< 60 seconds)", () => {
		it("returns 'just now' for current time", () => {
			const result = getTimeAgo(new Date());
			expect(result).toBe("just now");
		});

		it("returns 'just now' for 30 seconds ago", () => {
			const result = getTimeAgo(dateSecondsAgo(30));
			expect(result).toBe("just now");
		});

		it("returns 'just now' for 59 seconds ago", () => {
			const result = getTimeAgo(dateSecondsAgo(59));
			expect(result).toBe("just now");
		});
	});

	describe("minutes ago (1-59 minutes)", () => {
		it("returns '1 minute ago' for 1 minute ago (singular)", () => {
			const result = getTimeAgo(dateMinutesAgo(1));
			expect(result).toBe("1 minute ago");
		});

		it("returns '2 minutes ago' for 2 minutes ago (plural)", () => {
			const result = getTimeAgo(dateMinutesAgo(2));
			expect(result).toBe("2 minutes ago");
		});

		it("returns '30 minutes ago' for 30 minutes ago", () => {
			const result = getTimeAgo(dateMinutesAgo(30));
			expect(result).toBe("30 minutes ago");
		});

		it("returns '59 minutes ago' for 59 minutes ago", () => {
			const result = getTimeAgo(dateMinutesAgo(59));
			expect(result).toBe("59 minutes ago");
		});
	});

	describe("hours ago (1-23 hours)", () => {
		it("returns '1 hour ago' for 1 hour ago (singular)", () => {
			const result = getTimeAgo(dateHoursAgo(1));
			expect(result).toBe("1 hour ago");
		});

		it("returns '2 hours ago' for 2 hours ago (plural)", () => {
			const result = getTimeAgo(dateHoursAgo(2));
			expect(result).toBe("2 hours ago");
		});

		it("returns '12 hours ago' for 12 hours ago", () => {
			const result = getTimeAgo(dateHoursAgo(12));
			expect(result).toBe("12 hours ago");
		});

		it("returns '23 hours ago' for 23 hours ago", () => {
			const result = getTimeAgo(dateHoursAgo(23));
			expect(result).toBe("23 hours ago");
		});
	});

	describe("days ago (1-6 days)", () => {
		it("returns '1 day ago' for 1 day ago (singular)", () => {
			const result = getTimeAgo(dateDaysAgo(1));
			expect(result).toBe("1 day ago");
		});

		it("returns '2 days ago' for 2 days ago (plural)", () => {
			const result = getTimeAgo(dateDaysAgo(2));
			expect(result).toBe("2 days ago");
		});

		it("returns '6 days ago' for 6 days ago", () => {
			const result = getTimeAgo(dateDaysAgo(6));
			expect(result).toBe("6 days ago");
		});
	});

	describe("weeks ago (1-4 weeks)", () => {
		it("returns '1 week ago' for 7 days ago (singular)", () => {
			const result = getTimeAgo(dateDaysAgo(7));
			expect(result).toBe("1 week ago");
		});

		it("returns '2 weeks ago' for 14 days ago (plural)", () => {
			const result = getTimeAgo(dateWeeksAgo(2));
			expect(result).toBe("2 weeks ago");
		});

		it("returns '4 weeks ago' for 28 days ago", () => {
			const result = getTimeAgo(dateDaysAgo(28));
			expect(result).toBe("4 weeks ago");
		});
	});

	describe("months ago (30+ days)", () => {
		it("returns '1 month ago' for 30 days ago (singular)", () => {
			const result = getTimeAgo(dateDaysAgo(30));
			expect(result).toBe("1 month ago");
		});

		it("returns '2 months ago' for 60 days ago (plural)", () => {
			const result = getTimeAgo(dateMonthsAgo(2));
			expect(result).toBe("2 months ago");
		});

		it("returns '6 months ago' for 180 days ago", () => {
			const result = getTimeAgo(dateDaysAgo(180));
			expect(result).toBe("6 months ago");
		});

		it("returns '12 months ago' for 365 days ago", () => {
			const result = getTimeAgo(dateDaysAgo(365));
			expect(result).toBe("12 months ago");
		});
	});

	describe("edge cases", () => {
		it("handles exactly 60 seconds ago (transition to minutes)", () => {
			const result = getTimeAgo(dateSecondsAgo(60));
			expect(result).toBe("1 minute ago");
		});

		it("handles exactly 60 minutes ago (transition to hours)", () => {
			const result = getTimeAgo(dateMinutesAgo(60));
			expect(result).toBe("1 hour ago");
		});

		it("handles exactly 24 hours ago (transition to days)", () => {
			const result = getTimeAgo(dateHoursAgo(24));
			expect(result).toBe("1 day ago");
		});
	});
});
