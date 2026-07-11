import { defaults, types } from "pg";
import { describe, expect, it } from "vitest";

import { configurePostgresUtcTypes, withUtcPostgresSession } from "./postgres-utc";

describe("configurePostgresUtcTypes", () => {
	it("parses timestamp-without-time-zone values as UTC", () => {
		configurePostgresUtcTypes();

		const parseTimestamp = types.getTypeParser(1114, "text");
		const timestamp = parseTimestamp("2024-01-02 03:04:05.678");

		expect(defaults.parseInputDatesAsUTC).toBe(true);
		expect(timestamp).toBeInstanceOf(Date);
		expect(timestamp.toISOString()).toBe("2024-01-02T03:04:05.678Z");
	});

	it("rejects malformed timestamp-without-time-zone values", () => {
		configurePostgresUtcTypes();

		const parseTimestamp = types.getTypeParser(1114, "text");

		expect(() => parseTimestamp("2024-01-02T03:04:05Z")).toThrow(
			"Invalid PostgreSQL timestamp without time zone",
		);
		expect(() => parseTimestamp("2024-02-30 03:04:05")).toThrow(
			"Invalid PostgreSQL timestamp without time zone",
		);
	});

	it("preserves PostgreSQL infinity timestamp sentinels", () => {
		configurePostgresUtcTypes();

		const parseTimestamp = types.getTypeParser(1114, "text");

		expect(parseTimestamp("infinity")).toBe(Infinity);
		expect(parseTimestamp("-infinity")).toBe(-Infinity);
	});

	it("parses BC timestamp outputs as UTC dates", () => {
		configurePostgresUtcTypes();

		const parseTimestamp = types.getTypeParser(1114, "text");
		const timestamp = parseTimestamp("0001-02-03 04:05:06 BC") as Date;

		expect(timestamp).toBeInstanceOf(Date);
		expect(timestamp.toISOString()).toBe("0000-02-03T04:05:06.000Z");
	});
});

describe("withUtcPostgresSession", () => {
	it("preserves existing startup options while appending UTC", () => {
		expect(withUtcPostgresSession({ options: "-c statement_timeout=5000" })).toEqual({
			options: "-c statement_timeout=5000 -c timezone=UTC",
		});
	});

	it("does not duplicate an existing UTC startup option", () => {
		expect(withUtcPostgresSession({ options: "-c timezone=UTC" })).toEqual({
			options: "-c timezone=UTC",
		});
	});

	it("adds the UTC startup option when none exists", () => {
		expect(withUtcPostgresSession({ max: 10 })).toEqual({
			max: 10,
			options: "-c timezone=UTC",
		});
	});
});
