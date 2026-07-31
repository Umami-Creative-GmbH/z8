import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	calculateTimeCorrectionPeriod,
	dirtyFromDateForTimeCorrection,
	instantFromTimeCorrectionBoundary,
	instantToTimeCorrectionDate,
	parseTimeCorrectionRfc3339Evidence,
	serializeTimeCorrectionInstant,
	validateTimeCorrectionRange,
	validateTimeCorrectionTimezoneEvidence,
} from "./time-correction-temporal";

const endpoint = (
	id: string,
	instant: string,
	timezone: string,
	utcOffsetMinutes: number,
) => ({
	id,
	instant: parseInstant(instant),
	timezone,
	utcOffsetMinutes,
});

describe("time correction Temporal boundaries", () => {
	it("converts database Dates and external ISO timestamps through the existing instant boundary", () => {
		const date = new Date("2026-07-18T09:15:30.123Z");

		expect(instantFromTimeCorrectionBoundary(date).toString()).toBe(
			"2026-07-18T09:15:30.123Z",
		);
		expect(
			instantFromTimeCorrectionBoundary(
				"2026-07-18T11:15:30.123+02:00",
			).toString(),
		).toBe("2026-07-18T09:15:30.123Z");
		expect(
			instantToTimeCorrectionDate(parseInstant("2026-07-18T09:15:30.123Z")),
		).toEqual(date);
	});

	it("preserves the existing external canonical ISO format", () => {
		expect(
			serializeTimeCorrectionInstant(parseInstant("2026-07-18T11:15:30+02:00")),
		).toBe("2026-07-18T09:15:30Z");
	});
});

describe("calculateTimeCorrectionPeriod", () => {
	const originalClockIn = endpoint(
		"original-in",
		"2026-07-18T06:00:00Z",
		"Europe/Berlin",
		120,
	);
	const originalClockOut = endpoint(
		"original-out",
		"2026-07-18T14:00:00Z",
		"Europe/Berlin",
		120,
	);
	const correctedClockIn = endpoint(
		"correction-in",
		"2026-07-18T06:15:00Z",
		"Europe/Berlin",
		120,
	);
	const correctedClockOut = endpoint(
		"correction-out",
		"2026-07-18T14:30:00Z",
		"Europe/Berlin",
		120,
	);

	it("preserves clock-out for a clock-in-only edit", () => {
		expect(
			calculateTimeCorrectionPeriod({
				action: "edit",
				originalClockIn,
				originalClockOut,
				correctedClockIn,
				correctedClockOut: null,
			}),
		).toEqual({
			clockIn: correctedClockIn,
			clockOut: originalClockOut,
			durationMinutes: 465,
			isDeletion: false,
		});
	});

	it("preserves clock-in for a clock-out-only edit", () => {
		expect(
			calculateTimeCorrectionPeriod({
				action: "edit",
				originalClockIn,
				originalClockOut,
				correctedClockIn: null,
				correctedClockOut,
			}),
		).toEqual({
			clockIn: originalClockIn,
			clockOut: correctedClockOut,
			durationMinutes: 510,
			isDeletion: false,
		});
	});

	it("applies both corrected endpoints", () => {
		expect(
			calculateTimeCorrectionPeriod({
				action: "edit",
				originalClockIn,
				originalClockOut,
				correctedClockIn,
				correctedClockOut,
			}),
		).toMatchObject({
			clockIn: correctedClockIn,
			clockOut: correctedClockOut,
			durationMinutes: 495,
			isDeletion: false,
		});
	});

	it("supports an open period when only clock-in exists", () => {
		expect(
			calculateTimeCorrectionPeriod({
				action: "edit",
				originalClockIn,
				originalClockOut: null,
				correctedClockIn,
				correctedClockOut: null,
			}),
		).toMatchObject({
			clockOut: null,
			durationMinutes: null,
			isDeletion: false,
		});
	});

	it("requires a strict start-before-end range for edits", () => {
		expect(() =>
			calculateTimeCorrectionPeriod({
				action: "edit",
				originalClockIn,
				originalClockOut,
				correctedClockIn: endpoint(
					"correction-in",
					"2026-07-18T14:00:00Z",
					"Europe/Berlin",
					120,
				),
				correctedClockOut: null,
			}),
		).toThrow("Clock out time must be after clock in time");
	});

	it("requires equal correction sentinels and completed originals for deletion", () => {
		const deletionClockIn = endpoint(
			"deletion-in",
			"2026-07-18T06:00:00Z",
			"Europe/Berlin",
			120,
		);
		const deletionClockOut = endpoint(
			"deletion-out",
			"2026-07-18T06:00:00Z",
			"Europe/Berlin",
			120,
		);

		expect(
			calculateTimeCorrectionPeriod({
				action: "delete",
				originalClockIn,
				originalClockOut,
				correctedClockIn: deletionClockIn,
				correctedClockOut: deletionClockOut,
			}),
		).toEqual({
			clockIn: deletionClockIn,
			clockOut: deletionClockOut,
			durationMinutes: 0,
			isDeletion: true,
		});
		expect(() =>
			calculateTimeCorrectionPeriod({
				action: "delete",
				originalClockIn,
				originalClockOut: null,
				correctedClockIn: deletionClockIn,
				correctedClockOut: deletionClockOut,
			}),
		).toThrow("Deletion requires a completed work period");
		expect(() =>
			calculateTimeCorrectionPeriod({
				action: "delete",
				originalClockIn,
				originalClockOut,
				correctedClockIn: deletionClockIn,
				correctedClockOut,
			}),
		).toThrow("Deletion requires matching correction timestamps");
	});
});

describe("time correction timezone evidence", () => {
	it("parses explicit-offset REST evidence and derives the trusted offset", () => {
		expect(
			parseTimeCorrectionRfc3339Evidence(
				"2026-07-18T08:15:30.123+02:00",
				"Europe/Berlin",
			),
		).toMatchObject({
			timezone: "Europe/Berlin",
			utcOffsetMinutes: 120,
		});
		expect(
			parseTimeCorrectionRfc3339Evidence(
				"2026-07-18T08:15:30.123+02:00",
				"Europe/Berlin",
			).instant.toString(),
		).toBe("2026-07-18T06:15:30.123Z");
	});

	it.each([
		["offset-less input", "2026-07-18T08:15:00", "Europe/Berlin"],
		["malformed input", "not-a-timestamp", "Europe/Berlin"],
		["seasonal mismatch", "2026-01-18T08:15:00+02:00", "Europe/Berlin"],
		["DST gap mismatch", "2026-03-29T02:30:00+01:00", "Europe/Berlin"],
	])("rejects %s", (_label, timestamp, timezone) => {
		expect(() =>
			parseTimeCorrectionRfc3339Evidence(timestamp, timezone),
		).toThrow();
	});

	it.each([
		"2026-10-25T02:30:00+02:00",
		"2026-10-25T02:30:00+01:00",
	])("accepts a fold only when its explicit offset identifies a valid instant: %s", (timestamp) => {
		expect(() =>
			parseTimeCorrectionRfc3339Evidence(timestamp, "Europe/Berlin"),
		).not.toThrow();
	});

	it("validates each travel endpoint independently", () => {
		expect(() =>
			validateTimeCorrectionTimezoneEvidence(
				endpoint("in", "2026-07-18T06:00:00Z", "Europe/Berlin", 120),
			),
		).not.toThrow();
		expect(() =>
			validateTimeCorrectionTimezoneEvidence(
				endpoint("out", "2026-07-18T14:00:00Z", "America/New_York", -240),
			),
		).not.toThrow();
	});

	it("rejects a DST-season offset mismatch at the exact instant", () => {
		expect(() =>
			validateTimeCorrectionTimezoneEvidence(
				endpoint("in", "2026-01-18T06:00:00Z", "Europe/Berlin", 120),
			),
		).toThrow("Timezone offset does not match the event instant");
	});
});

describe("dirtyFromDateForTimeCorrection", () => {
	it("keeps a negative-offset local-late event on the previous date when UTC is next day", () => {
		expect(
			dirtyFromDateForTimeCorrection([
				endpoint(
					"late-local",
					"2026-07-19T03:30:00Z",
					"America/Los_Angeles",
					-420,
				),
			]),
		).toBe("2026-07-18");
	});

	it("uses independent zones for original and corrected travel endpoints", () => {
		expect(
			dirtyFromDateForTimeCorrection([
				endpoint("original", "2026-07-18T22:30:00Z", "Europe/Berlin", 120),
				endpoint("corrected", "2026-07-19T03:30:00Z", "America/New_York", -240),
			]),
		).toBe("2026-07-18");
	});

	it("uses each affected endpoint's trusted local date and returns the earliest", () => {
		expect(
			dirtyFromDateForTimeCorrection([
				endpoint("old-in", "2026-07-18T22:30:00Z", "Europe/Berlin", 120),
				endpoint("new-in", "2026-07-19T03:30:00Z", "America/New_York", -240),
			]),
		).toBe("2026-07-18");
	});

	it("handles a DST boundary without using UTC or the server timezone", () => {
		expect(
			dirtyFromDateForTimeCorrection([
				endpoint("before", "2026-03-29T00:30:00Z", "Europe/Berlin", 60),
				endpoint("after", "2026-03-29T01:30:00Z", "Europe/Berlin", 120),
			]),
		).toBe("2026-03-29");
	});

	it("returns null when no endpoint was affected", () => {
		expect(dirtyFromDateForTimeCorrection([])).toBeNull();
	});
});

describe("validateTimeCorrectionRange", () => {
	it("accepts a clock-out strictly after clock-in", () => {
		expect(() =>
			validateTimeCorrectionRange(
				parseInstant("2026-07-01T08:00:00Z"),
				parseInstant("2026-07-01T16:00:00Z"),
			),
		).not.toThrow();
	});

	it("rejects equal or reversed endpoints with the API-compatible message", () => {
		expect(() =>
			validateTimeCorrectionRange(
				parseInstant("2026-07-01T08:00:00Z"),
				parseInstant("2026-07-01T08:00:00Z"),
			),
		).toThrow("Clock out time must be after clock in time");
	});
});
