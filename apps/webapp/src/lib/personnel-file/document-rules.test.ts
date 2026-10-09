import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { todayInOrganization, validateDocumentMetadata } from "./document-rules";

const base = {
	category: "contract",
	title: "Employment contract",
	documentDate: "2026-03-01",
	payPeriod: null,
	visibility: "shared",
	expiryDate: null,
};

describe("validateDocumentMetadata", () => {
	it("accepts a contract without pay period or expiry date", () => {
		expect(validateDocumentMetadata(base)).toEqual({
			ok: true,
			value: {
				category: "contract",
				title: "Employment contract",
				documentDate: "2026-03-01",
				payPeriod: null,
				visibility: "shared",
				expiryDate: null,
			},
		});
	});

	it("accepts a payslip with a pay period", () => {
		const result = validateDocumentMetadata({
			...base,
			category: "payslip",
			payPeriod: { year: 2026, month: 2 },
		});
		expect(result).toMatchObject({ ok: true, value: { payPeriod: { year: 2026, month: 2 } } });
	});

	it("refuses a payslip without a pay period", () => {
		expect(validateDocumentMetadata({ ...base, category: "payslip" })).toMatchObject({
			ok: false,
			field: "payPeriod",
		});
	});

	it("refuses a pay period on every other category", () => {
		for (const category of ["contract", "certificate", "sick_note", "other"]) {
			expect(
				validateDocumentMetadata({ ...base, category, payPeriod: { year: 2026, month: 2 } }),
			).toMatchObject({ ok: false, field: "payPeriod" });
		}
	});

	it("refuses a pay period month outside 1-12", () => {
		expect(
			validateDocumentMetadata({
				...base,
				category: "payslip",
				payPeriod: { year: 2026, month: 13 },
			}),
		).toMatchObject({ ok: false, field: "payPeriod" });
	});

	it("allows an expiry date only on certificates and other documents", () => {
		for (const category of ["certificate", "other"]) {
			expect(
				validateDocumentMetadata({ ...base, category, expiryDate: "2027-12-31" }),
			).toMatchObject({ ok: true, value: { expiryDate: "2027-12-31" } });
		}
		for (const [category, payPeriod] of [
			["contract", null],
			["payslip", { year: 2026, month: 2 }],
			["sick_note", null],
		] as const) {
			expect(
				validateDocumentMetadata({ ...base, category, payPeriod, expiryDate: "2027-12-31" }),
			).toMatchObject({ ok: false, field: "expiryDate" });
		}
	});

	it("trims the title and refuses an empty one", () => {
		expect(validateDocumentMetadata({ ...base, title: "  Contract  " })).toMatchObject({
			ok: true,
			value: { title: "Contract" },
		});
		expect(validateDocumentMetadata({ ...base, title: "   " })).toMatchObject({
			ok: false,
			field: "title",
		});
		expect(validateDocumentMetadata({ ...base, title: "x".repeat(201) })).toMatchObject({
			ok: false,
			field: "title",
		});
	});

	it("refuses an impossible or malformed document date", () => {
		for (const documentDate of ["2026-02-30", "01.03.2026", "", null]) {
			expect(validateDocumentMetadata({ ...base, documentDate })).toMatchObject({
				ok: false,
				field: "documentDate",
			});
		}
	});

	it("refuses an unknown category or visibility", () => {
		expect(validateDocumentMetadata({ ...base, category: "invoice" })).toMatchObject({
			ok: false,
			field: "category",
		});
		expect(validateDocumentMetadata({ ...base, visibility: "public" })).toMatchObject({
			ok: false,
			field: "visibility",
		});
	});
});

describe("todayInOrganization", () => {
	it("is the calendar day in the organization's timezone, not UTC", () => {
		const lateEvening = Temporal.Instant.from("2026-03-01T23:30:00Z");
		expect(todayInOrganization(lateEvening, "Europe/Berlin")).toBe("2026-03-02");
		expect(todayInOrganization(lateEvening, "America/New_York")).toBe("2026-03-01");
	});

	it("falls back to UTC for an unknown timezone", () => {
		const instant = Temporal.Instant.from("2026-03-01T23:30:00Z");
		expect(todayInOrganization(instant, "Mars/Olympus")).toBe("2026-03-01");
	});
});
