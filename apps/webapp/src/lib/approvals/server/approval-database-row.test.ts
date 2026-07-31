import { describe, expect, it } from "vitest";
import {
	decodeApprovalDatabaseTimestamptz,
	decodeApprovalDatabaseTimestampWithoutTimeZone,
} from "../approval-database-row";

describe("approval database row decoding", () => {
	it.each([
		[
			"PostgreSQL space syntax",
			"2026-07-22 16:00:00",
			"2026-07-22T16:00:00.000Z",
		],
		["ISO separator", "2026-07-22T16:00:00", "2026-07-22T16:00:00.000Z"],
		[
			"fractional seconds",
			"2026-07-22 16:00:00.123456",
			"2026-07-22T16:00:00.123Z",
		],
	] as const)("decodes timestamp without time zone with %s", (_label, value, expected) => {
		expect(
			decodeApprovalDatabaseTimestampWithoutTimeZone(value).toISOString(),
		).toBe(expected);
	});

	it("accepts finite Date values at the timestamp without time zone boundary", () => {
		const value = new Date("2026-07-22T16:00:00.123Z");
		expect(decodeApprovalDatabaseTimestampWithoutTimeZone(value)).toBe(value);
	});

	it.each([
		"2026-07-22T16:00:00Z",
		"2026-07-22 16:00:00+00",
		"2026-07-22T16:00:00+02:30",
		"2026-02-30 16:00:00",
		"2026-07-22 24:00:00",
		"2026-07-22",
		"2026-07-22 16:00:00.1234567",
	] as const)("rejects invalid timestamp without time zone value %s", (value) => {
		expect(() => decodeApprovalDatabaseTimestampWithoutTimeZone(value)).toThrow(
			"Approval database row is invalid",
		);
	});

	it.each([
		["UTC Z", "2026-07-25T20:39:41.104Z", "2026-07-25T20:39:41.104Z"],
		[
			"PostgreSQL hour offset",
			"2026-07-25 20:39:41.104+00",
			"2026-07-25T20:39:41.104Z",
		],
		[
			"explicit offset",
			"2026-07-25T20:39:41.123456+02:30",
			"2026-07-25T18:09:41.123Z",
		],
	] as const)("decodes timestamptz with %s", (_label, value, expected) => {
		expect(decodeApprovalDatabaseTimestamptz(value).toISOString()).toBe(
			expected,
		);
	});

	it("accepts finite Date values at the timestamptz boundary", () => {
		const value = new Date("2026-07-25T20:39:41.104Z");
		expect(decodeApprovalDatabaseTimestamptz(value)).toBe(value);
	});

	it.each([
		"2026-07-25 20:39:41.104",
		"2026-02-30T20:39:41Z",
		"2026-07-25T24:00:00Z",
		"2026-07-25",
		"2026-07-25T20:39:41+24:00",
	] as const)("rejects invalid timestamptz value %s", (value) => {
		expect(() => decodeApprovalDatabaseTimestamptz(value)).toThrow(
			"Approval database row is invalid",
		);
	});
});
