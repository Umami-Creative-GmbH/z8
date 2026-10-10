import { describe, expect, it } from "vitest";
import { customFieldReportText, customFieldReportValues } from "./report-values";

const field = (
	id: string,
	name: string,
	type: "text" | "number" | "date" | "boolean" | "select",
	options: { id: string; label: string; archived: boolean }[] = [],
) => ({ id, name, type, options });

const fields = [
	field("f-text", "PO number", "text"),
	field("f-number", "Rate", "number"),
	field("f-date", "Start date", "date"),
	field("f-flag", "Union member", "boolean"),
	field("f-tier", "Tier", "select", [
		{ id: "o-gold", label: "Gold", archived: false },
		{ id: "o-old", label: "Bronze", archived: true },
	]),
];

describe("customFieldReportValues", () => {
	it("lists every field in order with its value as a report shows it", () => {
		expect(
			customFieldReportValues(fields, {
				"f-text": { type: "text", value: "PN-1" },
				"f-number": { type: "number", value: "12.5" },
				"f-date": { type: "date", value: "2024-02-29" },
				"f-flag": { type: "boolean", value: false },
				"f-tier": { type: "select", value: "o-gold" },
			}),
		).toEqual([
			{ fieldId: "f-text", name: "PO number", type: "text", value: "PN-1" },
			{ fieldId: "f-number", name: "Rate", type: "number", value: "12.5" },
			{ fieldId: "f-date", name: "Start date", type: "date", value: "2024-02-29" },
			{ fieldId: "f-flag", name: "Union member", type: "boolean", value: false },
			{ fieldId: "f-tier", name: "Tier", type: "select", value: "Gold" },
		]);
	});

	it("keeps a field without a value as null and shows an archived option's label", () => {
		expect(
			customFieldReportValues(fields, { "f-tier": { type: "select", value: "o-old" } }).map(
				(value) => value.value,
			),
		).toEqual([null, null, null, null, "Bronze"]);
	});

	it("treats a select value whose option is unknown as no value", () => {
		expect(
			customFieldReportValues([fields[4]], { "f-tier": { type: "select", value: "o-missing" } }),
		).toEqual([{ fieldId: "f-tier", name: "Tier", type: "select", value: null }]);
	});
});

describe("customFieldReportText", () => {
	it("writes booleans with the given labels and no value as empty text", () => {
		expect(customFieldReportText({ value: true })).toBe("Yes");
		expect(customFieldReportText({ value: false }, { yes: "true", no: "false" })).toBe("false");
		expect(customFieldReportText({ value: null })).toBe("");
		expect(customFieldReportText({ value: "2024-02-29" })).toBe("2024-02-29");
	});
});
