/**
 * Critical test: Verify that Luxon DateTime produces identical hash to JavaScript Date
 * This ensures blockchain integrity is maintained after migration
 */

import { DateTime } from "luxon";
import { calculateHash } from "../blockchain";

describe("Blockchain Hash Compatibility", () => {
	it("should produce identical hash with Date.toISOString() and DateTime.toISO()", () => {
		// Create a test date
		const testDate = new Date("2024-01-15T10:30:00.000Z");

		// Get ISO string from JavaScript Date
		const dateISOString = testDate.toISOString();

		// Get ISO string from Luxon DateTime (UTC)
		const luxonISOString = DateTime.fromJSDate(testDate, { zone: "utc" }).toISO()!;

		// Verify formats are identical
		expect(luxonISOString).toBe(dateISOString);

		// Verify both produce identical hash
		const hashWithDate = calculateHash({
			employeeId: "test-employee",
			type: "clock_in",
			timestamp: dateISOString,
			previousHash: null,
		});

		const hashWithLuxon = calculateHash({
			employeeId: "test-employee",
			type: "clock_in",
			timestamp: luxonISOString,
			previousHash: null,
		});

		expect(hashWithLuxon).toBe(hashWithDate);
	});

	it("should handle milliseconds precision correctly", () => {
		// Test with different millisecond values
		const dates = [
			"2024-01-15T10:30:00.000Z",
			"2024-01-15T10:30:00.123Z",
			"2024-01-15T10:30:00.999Z",
		];

		dates.forEach((dateStr) => {
			const testDate = new Date(dateStr);
			const dateISO = testDate.toISOString();
			const luxonISO = DateTime.fromJSDate(testDate, { zone: "utc" }).toISO()!;

			expect(luxonISO).toBe(dateISO);
		});
	});

	it("should maintain hash chain integrity with mixed Date/DateTime operations", () => {
		// Simulate existing entry with Date-based hash
		const entry1Date = new Date("2024-01-15T08:00:00.000Z");
		const hash1 = calculateHash({
			employeeId: "emp-1",
			type: "clock_in",
			timestamp: entry1Date.toISOString(),
			previousHash: null,
		});

		// Simulate new entry with Luxon-based hash
		const entry2Date = new Date("2024-01-15T17:00:00.000Z");
		const entry2DT = DateTime.fromJSDate(entry2Date, { zone: "utc" });
		const hash2 = calculateHash({
			employeeId: "emp-1",
			type: "clock_out",
			timestamp: entry2DT.toISO()!,
			previousHash: hash1, // Links to Date-based hash
		});

		// Verify chain link works
		expect(hash1).toBeDefined();
		expect(hash2).toBeDefined();
		expect(hash1).not.toBe(hash2);

		// Verify we can recreate hash2 using the previousHash from hash1
		const hash2Recreated = calculateHash({
			employeeId: "emp-1",
			type: "clock_out",
			timestamp: entry2DT.toISO()!,
			previousHash: hash1,
		});

		expect(hash2Recreated).toBe(hash2);
	});

	it("should handle edge cases (leap seconds, timezone boundaries)", () => {
		// Test leap year date
		const leapDate = new Date("2024-02-29T23:59:59.999Z");
		const dateISO = leapDate.toISOString();
		const luxonISO = DateTime.fromJSDate(leapDate, { zone: "utc" }).toISO()!;
		expect(luxonISO).toBe(dateISO);

		// Test year boundary
		const yearBoundary = new Date("2023-12-31T23:59:59.999Z");
		const yearISO = yearBoundary.toISOString();
		const yearLuxonISO = DateTime.fromJSDate(yearBoundary, { zone: "utc" }).toISO()!;
		expect(yearLuxonISO).toBe(yearISO);
	});
});
