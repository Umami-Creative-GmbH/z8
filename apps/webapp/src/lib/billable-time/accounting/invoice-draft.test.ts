import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	buildInvoiceDraft,
	checkInvoiceDraftFits,
	formatQuantityHours,
	type InvoiceDraftInput,
	invoiceDraftNetTotal,
	workLine,
} from "./invoice-draft";
import type { AccountingProviderCapabilities } from "./provider";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const capabilities: AccountingProviderCapabilities = {
	maxDraftLines: 3,
	supportedCurrencies: ["EUR"],
	supportedTaxTreatments: ["domestic_standard", "eu_reverse_charge"],
	draftStatusCheck: true,
	contactSearchMinLength: 3,
};

function input(overrides: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput {
	return {
		contactId: "contact-1",
		currency: "EUR",
		taxTreatment: { kind: "domestic_standard", rateBasisPoints: 1900 },
		servicePeriod: {
			from: Temporal.PlainDate.from("2026-09-01"),
			to: Temporal.PlainDate.from("2026-09-30"),
		},
		title: "Invoice",
		introduction: null,
		remark: null,
		lines: [
			workLine({
				projectId: "project-1",
				projectName: "Website",
				text: "Website, 1-30 Sep 2026, 1.50 h",
				durationMs: 90 * MINUTE_MS,
				unitPrice: BigInt(8550),
			}),
		],
		...overrides,
	};
}

describe("invoice draft lines", () => {
	it("states exact minutes as hours with two decimals, rounded half up", () => {
		expect(formatQuantityHours(workLine({ ...base(), durationMs: 90 * MINUTE_MS }))).toBe("1.50");
		// 10 minutes = 0.1666… h
		expect(formatQuantityHours(workLine({ ...base(), durationMs: 10 * MINUTE_MS }))).toBe("0.17");
		// 0.3 minutes = 0.005 h, a half
		expect(formatQuantityHours(workLine({ ...base(), durationMs: 18_000 }))).toBe("0.01");
		expect(formatQuantityHours(workLine({ ...base(), durationMs: 125 * HOUR_MS }))).toBe("125.00");
	});

	it("prices a line as the stated hours times the rate, as the tool computes it", () => {
		// 10 minutes at 85.50: 0.17 h x 85.50 = 14.535 -> 14.54
		const line = workLine({ ...base(), durationMs: 10 * MINUTE_MS, unitPrice: BigInt(8550) });
		expect(line.quantityHundredths).toBe(17);
		expect(line.amount).toBe(BigInt(1454));
	});

	function base() {
		return {
			projectId: "project-1",
			projectName: "Website",
			text: "Website",
			durationMs: HOUR_MS,
			unitPrice: BigInt(10000),
		};
	}
});

describe("buildInvoiceDraft", () => {
	it("builds a draft and sums its net total from the line amounts", () => {
		const result = buildInvoiceDraft(
			input({
				lines: [
					workLine({ ...lineBase(), durationMs: 90 * MINUTE_MS, unitPrice: BigInt(8550) }),
					workLine({ ...lineBase(), durationMs: 10 * MINUTE_MS, unitPrice: BigInt(8550) }),
					{ kind: "text", text: "Timesheet: 2 entries" },
				],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// 128.25 + 14.54
		expect(invoiceDraftNetTotal(result.draft)).toBe(BigInt(14279));
	});

	it("refuses a draft without work lines", () => {
		expect(buildInvoiceDraft(input({ lines: [{ kind: "text", text: "only text" }] }))).toEqual({
			ok: false,
			problem: "no_work_lines",
		});
	});

	it("refuses a draft without a contact", () => {
		expect(buildInvoiceDraft(input({ contactId: "  " }))).toEqual({
			ok: false,
			problem: "missing_contact",
		});
	});

	it("refuses a service period that ends before it starts", () => {
		expect(
			buildInvoiceDraft(
				input({
					servicePeriod: {
						from: Temporal.PlainDate.from("2026-09-30"),
						to: Temporal.PlainDate.from("2026-09-01"),
					},
				}),
			),
		).toEqual({ ok: false, problem: "invalid_service_period" });
	});

	it("refuses an empty or zero-length work line", () => {
		expect(
			buildInvoiceDraft(input({ lines: [workLine({ ...lineBase(), durationMs: 0 })] })),
		).toEqual({ ok: false, problem: "invalid_line" });
		expect(buildInvoiceDraft(input({ lines: [workLine({ ...lineBase(), text: " " })] }))).toEqual({
			ok: false,
			problem: "invalid_line",
		});
	});

	function lineBase() {
		return {
			projectId: "project-1",
			projectName: "Website",
			text: "Website",
			durationMs: HOUR_MS,
			unitPrice: BigInt(10000),
		};
	}
});

describe("checkInvoiceDraftFits", () => {
	it("accepts a draft within the provider's capabilities", () => {
		const result = buildInvoiceDraft(input());
		if (!result.ok) throw new Error(result.problem);
		expect(checkInvoiceDraftFits(result.draft, capabilities)).toEqual([]);
	});

	it("reports too many lines, an unsupported currency and an unsupported tax treatment", () => {
		const line = input().lines[0];
		const result = buildInvoiceDraft(
			input({
				currency: "CHF",
				taxTreatment: { kind: "vat_free", rateBasisPoints: 0 },
				lines: [line, line, line, { kind: "text", text: "Timesheet" }],
			}),
		);
		if (!result.ok) throw new Error(result.problem);
		expect(checkInvoiceDraftFits(result.draft, capabilities)).toEqual([
			{ problem: "too_many_lines", lines: 4, maxDraftLines: 3 },
			{ problem: "currency_not_supported", currency: "CHF" },
			{ problem: "tax_treatment_not_supported", taxTreatment: "vat_free" },
		]);
	});
});
