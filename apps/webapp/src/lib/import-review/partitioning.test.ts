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
});
