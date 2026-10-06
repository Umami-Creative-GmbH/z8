import { describe, expect, it } from "vitest";
import { parseMileagePolicyVersionInput } from "../mileage-policy-input";

describe("parseMileagePolicyVersionInput", () => {
	it("normalizes an organization's own rates and keeps their source", () => {
		expect(
			parseMileagePolicyVersionInput({
				source: "organization",
				effectiveFrom: "2026-04-01",
				currency: "eur",
				ratesPerKm: { car: "0,35", other_motor_vehicle: "" },
				sourceReference: " Works agreement 12/2026 ",
				sourceVersion: null,
				note: null,
			}),
		).toEqual({
			ok: true,
			input: {
				effectiveFrom: "2026-04-01",
				currency: "EUR",
				ratesPerKm: { car: "0.3500" },
				source: {
					kind: "organization",
					reference: "Works agreement 12/2026",
					version: null,
					defaultKey: null,
				},
				note: null,
				replacesVersionId: null,
			},
		});
	});

	it("requires a date, a currency and at least one valid rate", () => {
		expect(
			parseMileagePolicyVersionInput({
				source: "organization",
				effectiveFrom: "",
				currency: "EURO",
				ratesPerKm: {},
			}),
		).toEqual({
			ok: false,
			errors: { effectiveFrom: "invalid_date", currency: "invalid_currency", rates: "rate_required" },
		});
		expect(
			parseMileagePolicyVersionInput({
				source: "organization",
				effectiveFrom: "2026-04-01",
				currency: "EUR",
				ratesPerKm: { car: "-0.30" },
			}),
		).toEqual({ ok: false, errors: { car: "invalid_rate" } });
	});

	it("takes a statutory default's rates and citation from the catalog, never from the client", () => {
		const result = parseMileagePolicyVersionInput({
			source: "statutory_default",
			defaultKey: "de-mileage-estg-9-1-4a",
			effectiveFrom: "2026-01-01",
			currency: "USD",
			ratesPerKm: { car: "9.99" },
		});
		expect(result).toMatchObject({
			ok: true,
			input: {
				currency: "EUR",
				ratesPerKm: { car: "0.3000", other_motor_vehicle: "0.2000" },
				source: { kind: "statutory_default", defaultKey: "de-mileage-estg-9-1-4a" },
			},
		});
	});

	it("refuses adopting a default before the edition it was verified for, or an unknown default", () => {
		expect(
			parseMileagePolicyVersionInput({
				source: "statutory_default",
				defaultKey: "de-mileage-estg-9-1-4a",
				effectiveFrom: "2025-12-31",
			}),
		).toEqual({ ok: false, errors: { effectiveFrom: "before_default_validity" } });
		expect(
			parseMileagePolicyVersionInput({
				source: "statutory_default",
				defaultKey: "made-up",
				effectiveFrom: "2026-02-01",
			}),
		).toEqual({ ok: false, errors: { defaultKey: "unknown_default" } });
	});
});
