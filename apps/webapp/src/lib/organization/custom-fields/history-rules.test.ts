import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	applyCustomFieldHistoryChanges,
	type CustomFieldHistoryEntry,
	customFieldHistoryChangesOf,
	customFieldValueAsOf,
} from "./history-rules";
import type { CustomFieldValueField } from "./value-rules";

const day = (iso: string) => Temporal.PlainDate.from(iso);
const text = (value: string) => ({ type: "text", value }) as const;

const marchAndJuly: CustomFieldHistoryEntry[] = [
	{ id: "e-mar", validFrom: "2026-03-01", value: text("March") },
	{ id: "e-jul", validFrom: "2026-07-01", value: text("July") },
];

describe("customFieldValueAsOf", () => {
	it("returns the value with the latest valid-from on or before the date", () => {
		expect(customFieldValueAsOf(marchAndJuly, day("2026-06-30"))).toEqual(text("March"));
		expect(customFieldValueAsOf(marchAndJuly, day("2026-07-01"))).toEqual(text("July"));
		expect(customFieldValueAsOf(marchAndJuly, day("2027-01-01"))).toEqual(text("July"));
	});

	it("has no value before the first valid-from date", () => {
		expect(customFieldValueAsOf(marchAndJuly, day("2026-02-28"))).toBeNull();
		expect(customFieldValueAsOf([], day("2026-02-28"))).toBeNull();
	});

	it("does not depend on the order of the entries", () => {
		const reversed = [...marchAndJuly].reverse();
		expect(customFieldValueAsOf(reversed, day("2026-06-30"))).toEqual(text("March"));
	});
});

const textField: CustomFieldValueField = { id: "f-text", type: "text", number: null, options: [] };
const selectField: CustomFieldValueField = {
	id: "f-select",
	type: "select",
	number: null,
	options: [
		{ id: "gold", archived: false },
		{ id: "bronze", archived: true },
	],
};

function applied(
	entries: readonly CustomFieldHistoryEntry[],
	history: unknown,
	field: CustomFieldValueField = textField,
) {
	const result = applyCustomFieldHistoryChanges(field, entries, { history });
	if (!result.ok) throw new Error(`refused: ${result.reason}`);
	return result;
}

function refused(
	entries: readonly CustomFieldHistoryEntry[],
	input: unknown,
	field: CustomFieldValueField = textField,
) {
	const result = applyCustomFieldHistoryChanges(field, entries, input);
	return result.ok ? "accepted" : result.reason;
}

describe("applyCustomFieldHistoryChanges", () => {
	it("adds a change, also back-dated, and lists the history newest first", () => {
		const result = applied(marchAndJuly, [
			{ op: "add", validFrom: "2026-10-01", value: "October" },
			{ op: "add", validFrom: "2025-12-01", value: " December " },
		]);
		expect(result.entries.map((entry) => [entry.id, entry.validFrom, entry.value])).toEqual([
			[null, "2026-10-01", text("October")],
			["e-jul", "2026-07-01", text("July")],
			["e-mar", "2026-03-01", text("March")],
			[null, "2025-12-01", text("December")],
		]);
		expect(result.effects).toEqual([
			{ kind: "added", after: { validFrom: "2026-10-01", value: text("October") } },
			{ kind: "added", after: { validFrom: "2025-12-01", value: text("December") } },
		]);
	});

	it("corrects the value or the date of an entry, and deletes one", () => {
		const result = applied(marchAndJuly, [
			{ op: "correct", entryId: "e-mar", validFrom: "2026-02-01", value: "February" },
			{ op: "delete", entryId: "e-jul" },
		]);
		expect(result.entries).toEqual([
			{ id: "e-mar", validFrom: "2026-02-01", value: text("February") },
		]);
		expect(result.effects).toEqual([
			{
				kind: "corrected",
				before: marchAndJuly[0],
				after: { id: "e-mar", validFrom: "2026-02-01", value: text("February") },
			},
			{ kind: "deleted", before: marchAndJuly[1] },
		]);
	});

	it("skips a correction that changes nothing", () => {
		const result = applied(marchAndJuly, [
			{ op: "correct", entryId: "e-mar", validFrom: "2026-03-01", value: "March" },
		]);
		expect(result.effects).toEqual([]);
	});

	it("rejects two entries with the same valid-from date", () => {
		expect(
			refused(marchAndJuly, { history: [{ op: "add", validFrom: "2026-03-01", value: "x" }] }),
		).toBe("duplicate_valid_from");
		expect(
			refused(marchAndJuly, {
				history: [{ op: "correct", entryId: "e-jul", validFrom: "2026-03-01", value: "x" }],
			}),
		).toBe("duplicate_valid_from");
		expect(
			refused([], {
				history: [
					{ op: "add", validFrom: "2026-03-01", value: "x" },
					{ op: "add", validFrom: "2026-03-01", value: "y" },
				],
			}),
		).toBe("duplicate_valid_from");
	});

	it("allows a date that another change in the same save frees up", () => {
		const result = applied(marchAndJuly, [
			{ op: "delete", entryId: "e-mar" },
			{ op: "add", validFrom: "2026-03-01", value: "New March" },
			{ op: "correct", entryId: "e-jul", validFrom: "2026-08-01", value: "July" },
		]);
		expect(result.entries.map((entry) => entry.validFrom)).toEqual(["2026-08-01", "2026-03-01"]);
	});

	it("rejects unknown entries, bad dates, empty values and values breaking the type rules", () => {
		const one = (change: unknown) => refused(marchAndJuly, { history: [change] });
		expect(one({ op: "delete", entryId: "e-gone" })).toBe("unknown_history_entry");
		expect(one({ op: "correct", entryId: "e-gone", validFrom: "2026-01-01", value: "x" })).toBe(
			"unknown_history_entry",
		);
		expect(one({ op: "add", validFrom: "2026-02-30", value: "x" })).toBe("invalid_valid_from");
		expect(one({ op: "add", validFrom: "1.3.2026", value: "x" })).toBe("invalid_valid_from");
		expect(one({ op: "add", validFrom: "2026-01-01", value: "  " })).toBe("missing_value");
		expect(one({ op: "add", validFrom: "2026-01-01", value: null })).toBe("missing_value");
		expect(one({ op: "add", validFrom: "2026-01-01", value: "x".repeat(256) })).toBe(
			"text_too_long",
		);
		expect(
			refused(marchAndJuly, {
				history: [
					{ op: "delete", entryId: "e-mar" },
					{ op: "delete", entryId: "e-mar" },
				],
			}),
		).toBe("invalid_value");
	});

	it("rejects malformed input", () => {
		expect(refused(marchAndJuly, "x")).toBe("invalid_value");
		expect(refused(marchAndJuly, { history: "x" })).toBe("invalid_value");
		expect(refused(marchAndJuly, { history: [{ op: "rename" }] })).toBe("invalid_value");
		expect(refused(marchAndJuly, { history: [{ op: "add", value: "x" }] })).toBe(
			"invalid_valid_from",
		);
	});

	it("keeps an archived option an entry holds, but refuses it for a new entry", () => {
		const held: CustomFieldHistoryEntry[] = [
			{ id: "e-1", validFrom: "2026-01-01", value: { type: "select", value: "bronze" } },
		];
		expect(
			refused(
				held,
				{ history: [{ op: "correct", entryId: "e-1", validFrom: "2026-02-01", value: "bronze" }] },
				selectField,
			),
		).toBe("accepted");
		expect(
			refused(
				held,
				{ history: [{ op: "add", validFrom: "2026-03-01", value: "bronze" }] },
				selectField,
			),
		).toBe("option_archived");
	});
});

describe("customFieldHistoryChangesOf", () => {
	it("turns an edited history list into add, correct and delete changes", () => {
		expect(
			customFieldHistoryChangesOf(marchAndJuly, [
				{ entryId: null, validFrom: "2026-10-01", value: text("October") },
				{ entryId: "e-mar", validFrom: "2026-03-02", value: text("March") },
			]),
		).toEqual([
			{ op: "delete", entryId: "e-jul" },
			{ op: "correct", entryId: "e-mar", validFrom: "2026-03-02", value: "March" },
			{ op: "add", validFrom: "2026-10-01", value: "October" },
		]);
	});

	it("sends nothing for an unchanged list", () => {
		expect(
			customFieldHistoryChangesOf(
				marchAndJuly,
				marchAndJuly.map((entry) => ({ ...entry, entryId: entry.id })),
			),
		).toEqual([]);
	});
});
