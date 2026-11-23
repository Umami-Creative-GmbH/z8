import { describe, expect, it } from "vitest";
import englishTravelExpenses from "../../../../messages/travelExpenses/en.json";
import { settlementTitle } from "./settlement-title";

function flattenCatalog(value: unknown, prefix = ""): Record<string, string> {
	if (typeof value === "string") return { [prefix]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(messages, [key, child]) =>
			Object.assign(messages, flattenCatalog(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

/** Translates with the shipped English catalog, falling back to the code's English copy. */
function shippedEnglish() {
	const messages = flattenCatalog(englishTravelExpenses);
	return ((key: string, fallback: string, params?: Record<string, unknown>) =>
		(messages[key.replace(/^travelExpenses\./, "")] ?? fallback).replace(
			/\{(\w+)\}/g,
			(match, name: string) => (params && name in params ? String(params[name]) : match),
		)) as Parameters<typeof settlementTitle>[0];
}

describe("settlementTitle", () => {
	it("names an earlier claim in plain product words, never as legacy (#1979)", () => {
		const title = settlementTitle(shippedEnglish(), "en-US", {
			kind: "legacy_claim",
			claimType: "per_diem",
			startDate: "2026-04-20",
			endDate: "2026-04-21",
		});

		expect(title.name).toBe("Earlier per diem claim");
		expect(title.name).not.toMatch(/legacy/i);
	});
});
