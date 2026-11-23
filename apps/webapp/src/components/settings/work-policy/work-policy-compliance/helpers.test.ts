import { describe, expect, it } from "vitest";
import { jarbschgRules } from "@/lib/statutory/youth/jarbschg-rules";
import deCatalog from "../../../../../messages/settings/workPolicies/de.json";
import enCatalog from "../../../../../messages/settings/workPolicies/en.json";
import {
	buildCsvContent,
	formatCsvLocalMinute,
	formatViolationCsvDate,
	formatViolationDate,
	getViolationTypeLabel,
	violationLocalDate,
	violationTypeColors,
} from "./helpers";

function catalogText(catalog: unknown, key: string): unknown {
	return key
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
			catalog,
		);
}

describe("JArbSchG violation labels (#1993)", () => {
	it.each(jarbschgRules)("labels %s in English and German and gives it a colour", (rule) => {
		const keys: string[] = [];
		const label = getViolationTypeLabel(rule, (key, fallback) => {
			keys.push(key);
			return fallback;
		});
		expect(label).not.toBe(rule);
		expect(keys).toHaveLength(1);
		const english = catalogText(enCatalog, keys[0]);
		const german = catalogText(deCatalog, keys[0]);
		expect(english).toBe(label);
		expect(typeof german).toBe("string");
		expect(german).not.toBe(english);
		expect(violationTypeColors[rule]).toBeDefined();
	});
});

describe("work policy compliance helpers", () => {
	it("escapes quotes, commas, and line breaks in CSV cells", () => {
		expect(
			buildCsvContent(
				["Employee", "Acknowledged Note"],
				[["Avery, Stone", 'Reviewed "with manager"\nFollow-up scheduled']],
			),
		).toBe(
			'Employee,Acknowledged Note\n"Avery, Stone","Reviewed ""with manager""\nFollow-up scheduled"',
		);
	});

	it("resolves the violation day in the organization's timezone, not UTC", () => {
		// Work starting at 00:00 Berlin time is stored as 22:00 UTC the previous day.
		const violationDate = new Date("2026-09-19T22:00:00.000Z");

		expect(violationLocalDate(violationDate, "Europe/Berlin").toString()).toBe("2026-09-20");
		expect(violationLocalDate(violationDate, "UTC").toString()).toBe("2026-09-19");
		expect(formatViolationCsvDate(violationDate, "Europe/Berlin")).toBe("2026-09-20");
		expect(formatViolationCsvDate(violationDate, "America/New_York")).toBe("2026-09-19");
	});

	it("formats the organization-local violation day in the UI locale", () => {
		const violationDate = new Date("2026-09-19T22:00:00.000Z");

		expect(formatViolationDate(violationDate, { locale: "en-US", timezone: "Europe/Berlin" })).toBe(
			"Sep 20, 2026",
		);
		// German puts the day first, e.g. "20. Sept. 2026" (exact month abbreviation varies by ICU).
		expect(
			formatViolationDate(violationDate, { locale: "de-DE", timezone: "Europe/Berlin" }),
		).toMatch(/^20\. .+ 2026$/);
	});

	it("exports acknowledgement instants as organization-local minutes", () => {
		expect(formatCsvLocalMinute(new Date("2026-07-01T09:05:00.000Z"), "Europe/Berlin")).toBe(
			"2026-07-01 11:05",
		);
	});
});
