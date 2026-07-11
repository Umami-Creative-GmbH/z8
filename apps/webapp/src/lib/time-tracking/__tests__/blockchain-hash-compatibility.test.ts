/**
 * Critical test: Verify that Luxon DateTime produces identical hash to JavaScript Date
 * This ensures blockchain integrity is maintained after migration
 */

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { timeEntry } from "@/db/schema";
import { calculateHash, validateChain, validateChainDetailed, verifyHash } from "../blockchain";

type TimeEntry = typeof timeEntry.$inferSelect;

function createEntry(
	overrides: Pick<TimeEntry, "id" | "employeeId" | "type" | "timestamp" | "hash">,
): TimeEntry {
	return {
		...overrides,
		organizationId: "test-organization",
		previousHash: null,
		previousEntryId: null,
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
		notes: null,
		location: null,
		ipAddress: null,
		deviceInfo: null,
		createdAt: overrides.timestamp,
		createdBy: "test-user",
	};
}

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

	it("should preserve the timestamp hash byte contract", () => {
		const timestampHashPairs = [
			[
				"2024-01-15T10:30:00.000Z",
				"a73279cdaf64f2ab3bfc90ad8a142c33cbf5c2fc6de1496a77cd459e399d63ed",
			],
			[
				"2024-01-15T10:30:00.123Z",
				"165d9523f6703999733e2dcd2550b880c0bdff7121e123d654406aaee5302b16",
			],
			[
				"2024-01-15T10:30:00.999Z",
				"5aa2ee833dede15711d4ef4c1d7ccbb99ec470bbbd0c42f4bdcd92dcfd31a2de",
			],
		] as const;

		for (const [timestamp, expectedHash] of timestampHashPairs) {
			expect(
				calculateHash({
					employeeId: "test-employee",
					type: "clock_in",
					timestamp,
					previousHash: null,
				}),
			).toBe(expectedHash);
		}
	});

	it("preserves extended-year Date ISO bytes when validating persisted hashes", async () => {
		const timestamp = new Date("+010000-01-01T00:00:00.000Z");
		const timestampText = timestamp.toISOString();
		const hash = calculateHash({
			employeeId: "test-employee",
			type: "clock_in",
			timestamp: timestampText,
			previousHash: null,
		});
		const entry = createEntry({
			id: "extended-year-entry",
			employeeId: "test-employee",
			type: "clock_in",
			timestamp,
			hash,
		});

		expect(timestampText).toBe("+010000-01-01T00:00:00.000Z");
		expect(verifyHash(entry)).toEqual({ isValid: true, calculatedHash: hash, storedHash: hash });
		await expect(validateChain([entry])).resolves.toBe(true);
	});

	it("reports invalid persisted timestamps without throwing", async () => {
		const entry = createEntry({
			id: "invalid-timestamp-entry",
			employeeId: "test-employee",
			type: "clock_in",
			timestamp: new Date(Number.NaN),
			hash: "stored-hash",
		});

		expect(verifyHash(entry)).toEqual({
			isValid: false,
			calculatedHash: "",
			storedHash: "stored-hash",
		});
		await expect(validateChain([entry])).resolves.toBe(false);
		expect(validateChainDetailed([entry]).issues).toMatchObject([
			{ entryId: "invalid-timestamp-entry", type: "invalid_timestamp" },
		]);
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
