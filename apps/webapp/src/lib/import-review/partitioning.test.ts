import { describe, expect, it } from "vitest";
import { chunkEmployeeIds, partitionDateRangeByMonth } from "./partitioning";

describe("import review partitioning", () => {
	it("partitions date ranges by month", () => {
		expect(partitionDateRangeByMonth("2026-01-15", "2026-03-10")).toEqual([
			{ startDate: "2026-01-15", endDate: "2026-01-31" },
			{ startDate: "2026-02-01", endDate: "2026-02-28" },
			{ startDate: "2026-03-01", endDate: "2026-03-10" },
		]);
	});

	it("chunks employee ids without dropping leftovers", () => {
		expect(chunkEmployeeIds(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
	});

	it("rejects invalid date ranges", () => {
		expect(() => partitionDateRangeByMonth("not-a-date", "2026-03-10")).toThrow(
			"Invalid import start date: not-a-date",
		);
		expect(() => partitionDateRangeByMonth("2026-01-15", "not-a-date")).toThrow(
			"Invalid import end date: not-a-date",
		);
		expect(() => partitionDateRangeByMonth("2026-03-10", "2026-01-15")).toThrow(
			"Import start date must be on or before end date",
		);
	});

	it("rejects non-positive and fractional employee chunk sizes", () => {
		expect(() => chunkEmployeeIds(["a"], 0)).toThrow(RangeError);
		expect(() => chunkEmployeeIds(["a"], -1)).toThrow(RangeError);
		expect(() => chunkEmployeeIds(["a"], 1.5)).toThrow(RangeError);
	});
});
