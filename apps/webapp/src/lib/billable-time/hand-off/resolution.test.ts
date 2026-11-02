import { describe, expect, it } from "vitest";
import { comparisonItems, itemMarkVersion, parseResolutionInput } from "./resolution";

const ROOT = "11111111-1111-4111-8111-111111111111";

const item = (invoicedWorkId: string, markVersion = `${invoicedWorkId}:1`) => ({
	invoicedWorkId,
	markVersion,
});

describe("parseResolutionInput", () => {
	it("trims the explanation and treats an empty reference as none", () => {
		expect(
			parseResolutionInput({
				items: [item(ROOT)],
				explanation: "  Credit note sent  ",
				accountingReference: "   ",
			}),
		).toEqual({
			ok: true,
			value: {
				items: [item(ROOT)],
				explanation: "Credit note sent",
				accountingReference: null,
			},
		});
	});

	it("refuses a missing, blank or over-long explanation", () => {
		for (const explanation of [undefined, "", "   ", `${"x".repeat(2001)}`]) {
			const parsed = parseResolutionInput({ items: [item(ROOT)], explanation });
			expect(parsed.ok).toBe(false);
			expect(parsed.ok ? [] : parsed.errors).toContainEqual(
				expect.objectContaining({ field: "explanation" }),
			);
		}
		// The limit applies after trimming.
		expect(
			parseResolutionInput({ items: [item(ROOT)], explanation: ` ${"x".repeat(2000)} ` }).ok,
		).toBe(true);
	});

	it("refuses a reference over 200 characters", () => {
		const parsed = parseResolutionInput({
			items: [item(ROOT)],
			explanation: "Credit note",
			accountingReference: "R".repeat(201),
		});
		expect(parsed).toEqual({
			ok: false,
			errors: [{ field: "accountingReference", code: "too_long" }],
		});
		expect(
			parseResolutionInput({
				items: [item(ROOT)],
				explanation: "Credit note",
				accountingReference: "R".repeat(200),
			}).ok,
		).toBe(true);
	});

	it("refuses no items, malformed items and the same item twice", () => {
		for (const items of [
			[],
			"x",
			[{ invoicedWorkId: "nope", markVersion: "v" }],
			[{ invoicedWorkId: ROOT }],
			[item(ROOT), item(ROOT, "other")],
			Array.from({ length: 1001 }, (_, index) =>
				item(`${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`),
			),
		]) {
			const parsed = parseResolutionInput({ items, explanation: "Credit note" });
			expect(parsed.ok ? [] : parsed.errors).toContainEqual({ field: "items", code: "invalid" });
		}
	});
});

describe("comparison items", () => {
	const row = (
		id: string,
		workPeriodId: string,
		carriedFromWorkPeriodId: string | null,
		markVersion = 0,
		invoiceDraftId = "d1",
	) => ({ id, invoiceDraftId, workPeriodId, carriedFromWorkPeriodId, markVersion });

	it("groups split-off pieces, including pieces split again, under the handed-off row", () => {
		const items = comparisonItems([
			row("piece-2", "wp-3", "wp-2"),
			row("root", "wp-1", null),
			row("piece-1", "wp-2", "wp-1"),
			row("alone", "wp-9", null),
		]);
		expect([...items.entries()].map(([root, rows]) => [root, rows.map((r) => r.id)])).toEqual([
			["root", ["root", "piece-1", "piece-2"]],
			["alone", ["alone"]],
		]);
	});

	it("never joins pieces across drafts and keeps a piece whose original is gone as its own item", () => {
		const items = comparisonItems([
			row("root", "wp-1", null, 0, "d1"),
			row("elsewhere", "wp-2", "wp-1", 0, "d2"),
			row("orphan", "wp-5", "wp-gone", 0, "d1"),
		]);
		expect([...items.keys()]).toEqual(["root", "elsewhere", "orphan"]);
	});

	it("versions an item by every row's mark version, so any piece's change shows", () => {
		const before = itemMarkVersion([row("b", "wp-2", "wp-1", 3), row("a", "wp-1", null, 1)]);
		expect(before).toBe("a:1,b:3");
		expect(itemMarkVersion([row("a", "wp-1", null, 1), row("b", "wp-2", "wp-1", 4)])).not.toBe(
			before,
		);
		expect(itemMarkVersion([row("a", "wp-1", null, 1)])).not.toBe(before);
	});
});
