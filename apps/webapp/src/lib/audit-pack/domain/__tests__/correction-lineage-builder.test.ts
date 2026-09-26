import { describe, expect, it } from "vitest";
import { buildCorrectionClosure } from "../correction-lineage-builder";

describe("buildCorrectionClosure", () => {
	it("includes out-of-range linked nodes until closure", () => {
		const result = buildCorrectionClosure(
			[
				{
					id: "b",
					previousEntryId: "a",
					appendPredecessorId: "a",
					replacesEntryId: null,
					supersededById: "c",
				},
			],
			{
				a: {
					id: "a",
					previousEntryId: null,
					appendPredecessorId: null,
					replacesEntryId: null,
					supersededById: "b",
				},
				c: {
					id: "c",
					previousEntryId: "b",
					appendPredecessorId: "b",
					replacesEntryId: "b",
					supersededById: "d",
				},
				d: {
					id: "d",
					previousEntryId: "c",
					appendPredecessorId: "c",
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
				{
					id: "seed-2",
					previousEntryId: null,
					appendPredecessorId: null,
					replacesEntryId: null,
					supersededById: null,
				},
				{
					id: "seed-1",
					previousEntryId: null,
					appendPredecessorId: null,
					replacesEntryId: null,
					supersededById: null,
				},
			],
			{},
		);

		expect(result.nodeIds).toEqual(["seed-1", "seed-2"]);
		expect(result.expandedOutsideRange).toEqual([]);
	});

	it("follows resolved append links, including derived ones, instead of stored IDs", () => {
		const result = buildCorrectionClosure(
			[
				{
					id: "hash-only",
					previousEntryId: null,
					appendPredecessorId: "derived-predecessor",
					replacesEntryId: null,
					supersededById: null,
				},
				{
					id: "cross-employee",
					previousEntryId: "other-employee-entry",
					appendPredecessorId: null,
					replacesEntryId: null,
					supersededById: null,
				},
			],
			{
				"derived-predecessor": {
					id: "derived-predecessor",
					previousEntryId: null,
					appendPredecessorId: null,
					replacesEntryId: null,
					supersededById: null,
				},
			},
		);

		expect(result.nodeIds).toEqual(["cross-employee", "derived-predecessor", "hash-only"]);
		expect(result.expandedOutsideRange).toEqual(["derived-predecessor"]);
	});
});
