import { describe, expect, it } from "vitest";
import { buildCorrectionClosure } from "../correction-lineage-builder";

describe("buildCorrectionClosure", () => {
	it("includes out-of-range linked nodes until closure", () => {
		const result = buildCorrectionClosure(
			[
				{
					id: "b",
					previousEntryId: "a",
					replacesEntryId: null,
					supersededById: "c",
				},
			],
			{
				a: {
					id: "a",
					previousEntryId: null,
					replacesEntryId: null,
					supersededById: "b",
				},
				c: {
					id: "c",
					previousEntryId: "b",
					replacesEntryId: "b",
					supersededById: "d",
				},
				d: {
					id: "d",
					previousEntryId: "c",
					replacesEntryId: null,
					supersededById: null,
				},
			},
		);

		expect(result.nodeIds).toEqual(["a", "b", "c", "d"]);
		expect(result.expandedOutsideRange).toEqual(["a", "c", "d"]);
	});

	it("returns only in-range seed nodes when no linked expansion is present", () => {
		const result = buildCorrectionClosure(
			[
				{ id: "seed-2", previousEntryId: null, replacesEntryId: null, supersededById: null },
				{ id: "seed-1", previousEntryId: null, replacesEntryId: null, supersededById: null },
			],
			{},
		);

		expect(result.nodeIds).toEqual(["seed-1", "seed-2"]);
		expect(result.expandedOutsideRange).toEqual([]);
	});
});
