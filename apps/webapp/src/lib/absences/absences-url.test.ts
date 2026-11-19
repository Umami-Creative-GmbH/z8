import { describe, expect, it } from "vitest";
import { absencesSearch, parseAbsencesUrlState } from "./absences-url";

describe("parseAbsencesUrlState", () => {
	it("defaults to the calendar for the organization's current year", () => {
		expect(parseAbsencesUrlState({}, 2026)).toEqual({
			view: "calendar",
			year: 2026,
		});
	});

	it("reads the table view and a linked year", () => {
		expect(parseAbsencesUrlState({ view: "table", year: "2027" }, 2026)).toEqual({
			view: "table",
			year: 2027,
		});
	});

	it.each([
		["an unknown view", { view: "list" }],
		["an empty view", { view: "" }],
		["a non-numeric year", { year: "next" }],
		["a fractional year", { year: "2027.5" }],
		["a signed year", { year: "+2027" }],
		["a year with padding", { year: " 2027" }],
		["a year before 1900", { year: "1899" }],
		["a year after 2100", { year: "2101" }],
		["an empty year", { year: "" }],
	])("falls back silently for %s", (_, params) => {
		expect(parseAbsencesUrlState(params, 2026)).toEqual({
			view: "calendar",
			year: 2026,
		});
	});

	it("accepts the edges of the supported range", () => {
		expect(parseAbsencesUrlState({ year: "1900" }, 2026).year).toBe(1900);
		expect(parseAbsencesUrlState({ year: "2100" }, 2026).year).toBe(2100);
	});

	it("uses the first value of a repeated parameter", () => {
		expect(
			parseAbsencesUrlState({ view: ["table", "calendar"], year: ["2025", "2027"] }, 2026),
		).toEqual({ view: "table", year: 2025 });
	});
});

describe("absencesSearch", () => {
	it("leaves the defaults out of the URL", () => {
		expect(absencesSearch({ view: "calendar", year: 2026 }, 2026, new URLSearchParams())).toBe("");
	});

	it("writes a non-default view and year", () => {
		expect(absencesSearch({ view: "table", year: 2027 }, 2026, new URLSearchParams())).toBe(
			"?view=table&year=2027",
		);
	});

	it("keeps unrelated parameters and drops stale ones", () => {
		expect(
			absencesSearch(
				{ view: "calendar", year: 2026 },
				2026,
				new URLSearchParams("view=table&year=2027&utm=mail"),
			),
		).toBe("?utm=mail");
	});
});
