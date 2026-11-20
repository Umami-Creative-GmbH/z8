import { describe, expect, it } from "vitest";
import { assignMasonryColumns, preservesRelativeOrder } from "./stable-masonry";

const item = (key: string, height: number) => ({ key, height });

describe("assignMasonryColumns", () => {
	it("packs items into the shortest column in reading order", () => {
		const assignment = assignMasonryColumns(
			[item("a", 300), item("b", 100), item("c", 100), item("d", 50)],
			2,
		);

		expect(Object.fromEntries(assignment)).toEqual({ a: 0, b: 1, c: 1, d: 1 });
	});

	it("prefers the leftmost column on ties", () => {
		const assignment = assignMasonryColumns([item("a", 100), item("b", 100), item("c", 100)], 3);

		expect(Object.fromEntries(assignment)).toEqual({ a: 0, b: 1, c: 2 });
	});

	it("keeps placed items in their column when one of them grows", () => {
		const first = assignMasonryColumns(
			[item("approved", 300), item("team", 400), item("hydration", 200)],
			2,
		);
		expect(Object.fromEntries(first)).toEqual({ approved: 0, team: 1, hydration: 0 });

		const afterExpanding = assignMasonryColumns(
			[item("approved", 1200), item("team", 400), item("hydration", 200)],
			2,
			first,
		);

		expect(Object.fromEntries(afterExpanding)).toEqual(Object.fromEntries(first));
	});

	it("packs a newly appearing item into the shortest column without moving the others", () => {
		const first = assignMasonryColumns([item("a", 800), item("b", 200)], 2);

		const next = assignMasonryColumns([item("a", 800), item("new", 100), item("b", 200)], 2, first);

		expect(Object.fromEntries(next)).toEqual({ a: 0, b: 1, new: 1 });
	});

	it("re-packs kept items that no longer fit the column count", () => {
		const first = assignMasonryColumns([item("a", 100), item("b", 100), item("c", 100)], 3);

		const next = assignMasonryColumns([item("a", 100), item("b", 100), item("c", 100)], 2, first);

		expect(Object.fromEntries(next)).toEqual({ a: 0, b: 1, c: 0 });
	});

	it("treats a column count below one as a single column", () => {
		const assignment = assignMasonryColumns([item("a", 100), item("b", 100)], 0);

		expect(Object.fromEntries(assignment)).toEqual({ a: 0, b: 0 });
	});
});

describe("preservesRelativeOrder", () => {
	it("ignores keys that were added or removed", () => {
		expect(preservesRelativeOrder(["a", "b", "c"], ["a", "x", "c"])).toBe(true);
	});

	it("detects a reorder of shared keys", () => {
		expect(preservesRelativeOrder(["a", "b", "c"], ["b", "a", "c"])).toBe(false);
	});
});
