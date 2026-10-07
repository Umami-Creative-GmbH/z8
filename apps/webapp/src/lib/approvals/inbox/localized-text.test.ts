import { describe, expect, it } from "vitest";
import {
	formatApprovalInboxValue,
	localizedTextFallback,
	resolveLocalizedText,
} from "./localized-text";
import type { ApprovalInboxValue } from "./types";

const interpolate = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);

describe("formatApprovalInboxValue", () => {
	const cases: Array<[ApprovalInboxValue, string, string]> = [
		[{ kind: "plain_date", date: "2026-10-02" }, "Oct 2, 2026", "02.10.2026"],
		[
			{ kind: "plain_date_range", start: "2026-10-01", end: "2026-10-03" },
			"Oct 1, 2026 – Oct 3, 2026",
			"01.10.2026 – 03.10.2026",
		],
		[
			{ kind: "plain_date_range", start: "2026-10-01", end: "2026-10-01" },
			"Oct 1, 2026",
			"01.10.2026",
		],
		[{ kind: "money", amount: "440.61", currency: "EUR" }, "€440.61", "440,61 €"],
		[{ kind: "money", amount: "240.50", currency: "CHF" }, "CHF 240.50", "240,50 CHF"],
		[{ kind: "money", amount: "12.00", currency: "EUR", signed: true }, "+€12.00", "+12,00 €"],
		[{ kind: "money", amount: "-12.00", currency: "EUR", signed: true }, "-€12.00", "-12,00 €"],
		[{ kind: "country", code: "DE" }, "Germany", "Deutschland"],
		[{ kind: "country", code: "FR" }, "France", "Frankreich"],
	];

	it.each(cases)("formats %j like the report pages in EN and DE", (value, en, de) => {
		// Intl may use a narrow no-break space before the currency sign.
		const normalize = (formatted: string) => formatted.replace(/\s/g, " ");
		expect(normalize(formatApprovalInboxValue("en", value))).toBe(en);
		expect(normalize(formatApprovalInboxValue("de", value))).toBe(de);
	});
});

describe("resolveLocalizedText", () => {
	it("formats typed parameters and typed values with the given locale", () => {
		const destination = {
			key: "x.destination",
			fallback: "{place}, {country}",
			params: { place: "Paris", country: { kind: "country" as const, code: "FR" } },
		};
		expect(resolveLocalizedText(destination, interpolate, "de")).toBe("Paris, Frankreich");
		expect(
			resolveLocalizedText({ kind: "money", amount: "89.90", currency: "EUR" }, interpolate, "en"),
		).toBe("€89.90");
	});

	it("keeps canonical values in the English default used by tests and logs", () => {
		expect(
			localizedTextFallback({
				key: "x.summary",
				fallback: "reimbursable {amount} on {date}",
				params: {
					amount: { kind: "money", amount: "89.90", currency: "EUR" },
					date: { kind: "plain_date", date: "2026-09-14" },
				},
			}),
		).toBe("reimbursable 89.90 EUR on 2026-09-14");
	});
});
