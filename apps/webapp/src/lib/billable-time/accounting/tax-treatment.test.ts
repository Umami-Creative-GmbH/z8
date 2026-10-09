import { describe, expect, it } from "vitest";
import {
	effectiveTaxTreatment,
	formatTaxRate,
	parseTaxTreatment,
	TAX_TREATMENT_KINDS,
	taxTreatmentFromStored,
} from "./tax-treatment";

describe("tax treatment", () => {
	it("lists the five Z8 tax treatments", () => {
		expect(TAX_TREATMENT_KINDS).toEqual([
			"domestic_standard",
			"domestic_reduced",
			"eu_reverse_charge",
			"third_country_service",
			"vat_free",
		]);
	});

	it("reads a domestic standard treatment with its rate in basis points", () => {
		expect(parseTaxTreatment({ kind: "domestic_standard", rate: "19" })).toEqual({
			ok: true,
			treatment: { kind: "domestic_standard", rateBasisPoints: 1900 },
		});
		expect(parseTaxTreatment({ kind: "domestic_reduced", rate: "7,7" })).toEqual({
			ok: true,
			treatment: { kind: "domestic_reduced", rateBasisPoints: 770 },
		});
	});

	it("requires a positive rate of at most 100 percent for domestic treatments", () => {
		expect(parseTaxTreatment({ kind: "domestic_standard", rate: "0" })).toEqual({
			ok: false,
			reason: "invalid_rate",
		});
		expect(parseTaxTreatment({ kind: "domestic_standard", rate: "100.01" })).toEqual({
			ok: false,
			reason: "invalid_rate",
		});
		expect(parseTaxTreatment({ kind: "domestic_reduced", rate: "7.125" })).toEqual({
			ok: false,
			reason: "invalid_rate",
		});
		expect(parseTaxTreatment({ kind: "domestic_reduced", rate: "abc" })).toEqual({
			ok: false,
			reason: "invalid_rate",
		});
	});

	it("taxes reverse charge, third-country service and VAT-free drafts at zero", () => {
		for (const kind of ["eu_reverse_charge", "third_country_service", "vat_free"] as const) {
			expect(parseTaxTreatment({ kind, rate: "" })).toEqual({
				ok: true,
				treatment: { kind, rateBasisPoints: 0 },
			});
			expect(parseTaxTreatment({ kind, rate: "0.00" })).toEqual({
				ok: true,
				treatment: { kind, rateBasisPoints: 0 },
			});
			expect(parseTaxTreatment({ kind, rate: "19" })).toEqual({
				ok: false,
				reason: "invalid_rate",
			});
		}
	});

	it("refuses an unknown kind", () => {
		expect(parseTaxTreatment({ kind: "small_business", rate: "0" })).toEqual({
			ok: false,
			reason: "invalid_kind",
		});
		expect(parseTaxTreatment(null)).toEqual({ ok: false, reason: "invalid_kind" });
	});

	it("round-trips the stored numeric rate", () => {
		expect(taxTreatmentFromStored("domestic_standard", "19.00")).toEqual({
			kind: "domestic_standard",
			rateBasisPoints: 1900,
		});
		expect(formatTaxRate(1900)).toBe("19.00");
		expect(formatTaxRate(770)).toBe("7.70");
		expect(formatTaxRate(0)).toBe("0.00");
	});

	it("lets a customer override win over the connection default", () => {
		const fallback = { kind: "domestic_standard", rateBasisPoints: 1900 } as const;
		const override = { kind: "eu_reverse_charge", rateBasisPoints: 0 } as const;
		expect(effectiveTaxTreatment(fallback, override)).toEqual({ ...override, source: "customer" });
		expect(effectiveTaxTreatment(fallback, null)).toEqual({ ...fallback, source: "connection" });
	});
});
