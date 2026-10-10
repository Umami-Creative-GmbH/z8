import { describe, expect, it } from "vitest";
import {
	type CustomFieldValueField,
	customFieldDraftOf,
	customFieldInputOfDraft,
	missingRequiredCustomFieldIds,
	parseCustomFieldValueInput,
} from "./value-rules";

const text: CustomFieldValueField = { id: "f-text", type: "text", number: null, options: [] };
const number = (settings: Partial<NonNullable<CustomFieldValueField["number"]>> = {}) =>
	({
		id: "f-number",
		type: "number",
		number: { integerOnly: false, min: null, max: null, ...settings },
		options: [],
	}) satisfies CustomFieldValueField;
const date: CustomFieldValueField = { id: "f-date", type: "date", number: null, options: [] };
const flag: CustomFieldValueField = { id: "f-bool", type: "boolean", number: null, options: [] };
const select: CustomFieldValueField = {
	id: "f-select",
	type: "select",
	number: null,
	options: [
		{ id: "gold", archived: false },
		{ id: "bronze", archived: true },
	],
};

describe("parseCustomFieldValueInput", () => {
	it("treats null and empty input as clearing the value", () => {
		for (const field of [text, number(), date, select]) {
			expect(parseCustomFieldValueInput(field, null)).toEqual({ ok: true, value: null });
			expect(parseCustomFieldValueInput(field, "  ")).toEqual({ ok: true, value: null });
		}
		expect(parseCustomFieldValueInput(flag, null)).toEqual({ ok: true, value: null });
	});

	it("keeps trimmed text up to 255 characters", () => {
		expect(parseCustomFieldValueInput(text, "  PN-0042 ")).toEqual({
			ok: true,
			value: { type: "text", value: "PN-0042" },
		});
		expect(parseCustomFieldValueInput(text, "x".repeat(255)).ok).toBe(true);
		expect(parseCustomFieldValueInput(text, "x".repeat(256))).toEqual({
			ok: false,
			reason: "text_too_long",
		});
		expect(parseCustomFieldValueInput(text, true)).toEqual({ ok: false, reason: "invalid_value" });
	});

	it("reads decimals with a comma or a dot as canonical decimal strings", () => {
		expect(parseCustomFieldValueInput(number(), "0012,50")).toEqual({
			ok: true,
			value: { type: "number", value: "12.5" },
		});
		expect(parseCustomFieldValueInput(number(), "-0.0")).toEqual({
			ok: true,
			value: { type: "number", value: "0" },
		});
		expect(parseCustomFieldValueInput(number(), "1e3")).toEqual({
			ok: false,
			reason: "invalid_number",
		});
		expect(parseCustomFieldValueInput(number(), "12abc")).toEqual({
			ok: false,
			reason: "invalid_number",
		});
	});

	it("applies integer-only and min/max", () => {
		expect(parseCustomFieldValueInput(number({ integerOnly: true }), "2.5")).toEqual({
			ok: false,
			reason: "number_not_integer",
		});
		expect(parseCustomFieldValueInput(number({ integerOnly: true }), "2.0")).toEqual({
			ok: true,
			value: { type: "number", value: "2" },
		});
		const bounded = number({ min: "-1.5", max: "100" });
		expect(parseCustomFieldValueInput(bounded, "-1.5").ok).toBe(true);
		expect(parseCustomFieldValueInput(bounded, "100").ok).toBe(true);
		expect(parseCustomFieldValueInput(bounded, "-1.51")).toEqual({
			ok: false,
			reason: "number_out_of_range",
		});
		expect(parseCustomFieldValueInput(bounded, "100.000001")).toEqual({
			ok: false,
			reason: "number_out_of_range",
		});
		expect(
			parseCustomFieldValueInput(number({ max: "999999999999999.99" }), "999999999999999.991"),
		).toEqual({ ok: false, reason: "number_out_of_range" });
	});

	it("accepts real calendar dates as YYYY-MM-DD", () => {
		expect(parseCustomFieldValueInput(date, "2024-02-29")).toEqual({
			ok: true,
			value: { type: "date", value: "2024-02-29" },
		});
		for (const invalid of ["2023-02-29", "2024-13-01", "2024-1-5", "05.01.2024"]) {
			expect(parseCustomFieldValueInput(date, invalid)).toEqual({
				ok: false,
				reason: "invalid_date",
			});
		}
	});

	it("accepts an active option of the field only", () => {
		expect(parseCustomFieldValueInput(select, "gold")).toEqual({
			ok: true,
			value: { type: "select", value: "gold" },
		});
		expect(parseCustomFieldValueInput(select, "bronze")).toEqual({
			ok: false,
			reason: "option_archived",
		});
		expect(parseCustomFieldValueInput(select, "silver")).toEqual({
			ok: false,
			reason: "invalid_option",
		});
	});

	it("keeps an archived option the record already holds", () => {
		expect(
			parseCustomFieldValueInput(select, "bronze", { type: "select", value: "bronze" }),
		).toEqual({ ok: true, value: { type: "select", value: "bronze" } });
	});

	it("reads booleans", () => {
		expect(parseCustomFieldValueInput(flag, false)).toEqual({
			ok: true,
			value: { type: "boolean", value: false },
		});
		expect(parseCustomFieldValueInput(flag, "yes")).toEqual({ ok: false, reason: "invalid_value" });
	});
});

describe("form drafts", () => {
	it("round-trips values through form drafts", () => {
		expect(customFieldDraftOf(null)).toBe("");
		expect(customFieldDraftOf({ type: "boolean", value: false })).toBe("false");
		expect(customFieldDraftOf({ type: "number", value: "12.5" })).toBe("12.5");
		expect(customFieldInputOfDraft("boolean", "true")).toBe(true);
		expect(customFieldInputOfDraft("boolean", "false")).toBe(false);
		expect(customFieldInputOfDraft("boolean", "")).toBeNull();
		expect(customFieldInputOfDraft("text", "")).toBeNull();
		expect(customFieldInputOfDraft("date", "2024-01-05")).toBe("2024-01-05");
	});
});

describe("missingRequiredCustomFieldIds", () => {
	it("lists required fields without a value", () => {
		const fields = [
			{ id: "a", required: true },
			{ id: "b", required: true },
			{ id: "c", required: false },
		];
		expect(missingRequiredCustomFieldIds(fields, { b: { type: "text", value: "x" } })).toEqual([
			"a",
		]);
	});
});
