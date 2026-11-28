import { describe, expect, it } from "vitest";
import {
	ibanLastFour,
	parseAccountHolder,
	parseBankAccount,
	parseBic,
	parseIban,
	parseValidFrom,
} from "./validation";

describe("parseIban", () => {
	it("accepts an IBAN typed with spaces and in lower case, normalized", () => {
		expect(parseIban(" de89 3704 0044 0532 0130 00 ")).toEqual({
			ok: true,
			value: "DE89370400440532013000",
		});
	});

	it.each([
		["AT", "AT611904300234573201"],
		["CH", "CH9300762011623852957"],
		["GB", "GB29NWBK60161331926819"],
		["NO", "NO9386011117947"],
		["MT", "MT84MALT011000012345MTLCAST001S"],
		["FR", "FR1420041010050500013M02606"],
		// Serbia joined the SEPA schemes' geographical scope in May 2025.
		["RS", "RS35260005601001611379"],
	])("accepts a valid IBAN from the SEPA country %s", (_country, iban) => {
		expect(parseIban(iban)).toEqual({ ok: true, value: iban });
	});

	it("refuses an empty IBAN", () => {
		expect(parseIban("   ")).toEqual({ ok: false, code: "iban_required" });
	});

	it.each([
		["US", "US64SVBKUS6S3300958879"],
		["BR", "BR1800360305000010009795493C1"],
		["TR", "TR330006100519786457841326"],
	])("refuses an IBAN from %s, outside the SEPA area", (_country, iban) => {
		expect(parseIban(iban)).toEqual({ ok: false, code: "iban_not_sepa" });
	});

	it("refuses an IBAN that does not start with a country code and check digits", () => {
		expect(parseIban("1234")).toEqual({ ok: false, code: "iban_format" });
		expect(parseIban("DE8937040044053201300!")).toEqual({ ok: false, code: "iban_format" });
	});

	it("refuses an IBAN of the wrong length for its country", () => {
		expect(parseIban("DE8937040044053201300")).toEqual({ ok: false, code: "iban_length" });
		expect(parseIban("DE893704004405320130000")).toEqual({ ok: false, code: "iban_length" });
	});

	it("refuses an IBAN whose mod-97 checksum is wrong", () => {
		expect(parseIban("DE88370400440532013000")).toEqual({ ok: false, code: "iban_checksum" });
		expect(parseIban("DE89370400440532013001")).toEqual({ ok: false, code: "iban_checksum" });
	});
});

describe("parseBic", () => {
	it("treats a blank BIC as none: it is optional", () => {
		expect(parseBic("")).toEqual({ ok: true, value: null });
		expect(parseBic("   ")).toEqual({ ok: true, value: null });
		expect(parseBic(null)).toEqual({ ok: true, value: null });
	});

	it("accepts an 8- or 11-character BIC, normalized to upper case without spaces", () => {
		expect(parseBic("cobadeff")).toEqual({ ok: true, value: "COBADEFF" });
		expect(parseBic("COBA DE FF XXX")).toEqual({ ok: true, value: "COBADEFFXXX" });
		expect(parseBic("DEUTDEDB101")).toEqual({ ok: true, value: "DEUTDEDB101" });
	});

	it.each([
		"COBADEF",
		"COBADEFF1",
		"COBADEFFXX",
		"COBADEFFXXXX",
		"C0BADEFF",
		"COBA12FF",
		"COBADEF!",
	])("refuses %s, which is not in BIC format", (bic) => {
		expect(parseBic(bic)).toEqual({ ok: false, code: "bic_format" });
	});
});

describe("parseAccountHolder", () => {
	it("trims the account holder", () => {
		expect(parseAccountHolder("  Erika Mustermann ")).toEqual({
			ok: true,
			value: "Erika Mustermann",
		});
	});

	it("requires an account holder", () => {
		expect(parseAccountHolder("  ")).toEqual({ ok: false, code: "account_holder_required" });
	});

	it("refuses an account holder longer than the 70 characters a SEPA name holds", () => {
		expect(parseAccountHolder("x".repeat(70))).toMatchObject({ ok: true });
		expect(parseAccountHolder("x".repeat(71))).toEqual({
			ok: false,
			code: "account_holder_too_long",
		});
	});
});

describe("parseBankAccount", () => {
	it("returns the normalized bank account", () => {
		expect(
			parseBankAccount({
				accountHolder: " Erika Mustermann",
				iban: "de89 3704 0044 0532 0130 00",
				bic: "cobadeff",
			}),
		).toEqual({
			ok: true,
			value: {
				accountHolder: "Erika Mustermann",
				iban: "DE89370400440532013000",
				bic: "COBADEFF",
			},
		});
	});

	it("names every field that is refused", () => {
		expect(parseBankAccount({ accountHolder: "", iban: "DE00 1234", bic: "X" })).toEqual({
			ok: false,
			errors: {
				accountHolder: "account_holder_required",
				iban: "iban_length",
				bic: "bic_format",
			},
		});
	});
});

describe("parseValidFrom", () => {
	it("accepts a calendar day, past or future", () => {
		expect(parseValidFrom("2020-02-29")).toMatchObject({ ok: true });
		expect(parseValidFrom("2030-01-01")).toMatchObject({ ok: true });
		const parsed = parseValidFrom("2026-11-28");
		expect(parsed.ok && parsed.value.toString()).toBe("2026-11-28");
	});

	it.each(["", "2026-02-30", "28.11.2026", "2026-1-1", "1899-12-31", "10000-01-01"])(
		"refuses %s",
		(input) => {
			expect(parseValidFrom(input)).toEqual({ ok: false, code: "valid_from_invalid" });
		},
	);
});

describe("ibanLastFour", () => {
	it("is the last four characters of the normalized IBAN", () => {
		expect(ibanLastFour("DE89370400440532013000")).toBe("3000");
		expect(ibanLastFour("MT84MALT011000012345MTLCAST001S")).toBe("001S");
	});
});
