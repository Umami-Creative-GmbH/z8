/**
 * The `POST /Invoice/Factory/saveInvoice` body for one Z8 invoice draft (#905).
 * Pure; follows `saveInvoice`, `Model_Invoice` and `Model_InvoicePos` in
 * https://api.sevdesk.de/openapi.yaml (read 2026-10-09):
 *
 * - Top level in the documented order; "the order of the last four attributes
 *   always needs to be kept" and all four must be sent (`invoicePosDelete`,
 *   `discountSave`, `discountDelete`, `takeDefaultAddress`). `takeDefaultAddress`
 *   fills the address from the linked contact (Z8 never sends addresses).
 * - `Model_Invoice` properties in documented order, only those Z8 sets.
 *   `status: "100"` creates a draft; the factory cannot finalize anyway.
 * - Dates: `invoiceDate`/`deliveryDate` as `dd.mm.yyyy` (documented examples),
 *   `deliveryDateUntil` as a Unix timestamp (documented type integer). The service
 *   period is the hand-off period; sevdesk refuses a regular invoice whose delivery
 *   date is after its invoice date, so the invoice date is never before the period end.
 * - Tax: sevdesk-Update 2.0 `taxRule` (taxType is the 1.0 field and is not sent);
 *   the invoice-level `taxRate` "is not used anymore", positions carry theirs.
 * - Prices: `price` is net or gross "depending on the sevdesk account setting";
 *   connections are only accepted for net-price accounts, and `showNet: true`.
 *
 * JSON numbers are the wire format: hours and prices come from Z8's exact
 * integer amounts and are written as short decimals (2.5, 95), never computed in
 * floating point.
 */

import type { PlainDate } from "@/lib/datetime/temporal-core";
import { formatUnits } from "@/lib/money/exact-decimal";
import type { InvoiceDraft } from "../invoice-draft";
import { formatTaxRate, type TaxTreatment } from "../tax-treatment";

/** sevdesk's bookkeeping dates are German calendar days. */
export const SEVDESK_TIME_ZONE = "Europe/Berlin";

/** Rates sevdesk-Update 2.0 allows for tax rule 1 "Umsatzsteuerpflichtige Umsätze" (besides 0). */
const DOMESTIC_RATES_BASIS_POINTS = new Set([700, 1900]);

interface SevdeskTaxRule {
	id: number;
	text: string;
	positionRate: number;
}

/**
 * Z8 tax treatment → sevdesk-Update 2.0 tax rule (openapi.yaml "Tax rules";
 * tech.sevdesk.com news 2024-12-17 for rule 17 and 2025-05-12 for rule 21).
 */
export function sevdeskTaxRule(
	treatment: TaxTreatment,
): { ok: true; rule: SevdeskTaxRule } | { ok: false; message: string } {
	switch (treatment.kind) {
		case "domestic_standard":
		case "domestic_reduced": {
			if (!DOMESTIC_RATES_BASIS_POINTS.has(treatment.rateBasisPoints)) {
				return {
					ok: false,
					message: `sevdesk accepts 7 % or 19 % for domestic invoice drafts, not ${formatTaxRate(treatment.rateBasisPoints)} %. Change the tax treatment`,
				};
			}
			const percent = treatment.rateBasisPoints / 100;
			return {
				ok: true,
				rule: { id: 1, text: `Umsatzsteuer ${percent}%`, positionRate: percent },
			};
		}
		case "eu_reverse_charge":
			return {
				ok: true,
				rule: {
					id: 21,
					text: "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)",
					positionRate: 0,
				},
			};
		case "third_country_service":
			return {
				ok: true,
				rule: { id: 17, text: "Nicht im Inland steuerbare Leistung", positionRate: 0 },
			};
		case "vat_free":
			return {
				ok: true,
				rule: { id: 4, text: "Steuerfreie Umsätze §4 UStG", positionRate: 0 },
			};
	}
}

export function formatSevdeskDate(date: PlainDate): string {
	const day = String(date.day).padStart(2, "0");
	const month = String(date.month).padStart(2, "0");
	return `${day}.${month}.${String(date.year).padStart(4, "0")}`;
}

/** Start of the day in Berlin, as Unix seconds (how sevdesk stores dates). */
export function sevdeskTimestamp(date: PlainDate): number {
	return Math.floor(date.toZonedDateTime({ timeZone: SEVDESK_TIME_ZONE }).epochMilliseconds / 1000);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** sevdesk's head/foot texts are HTML: escape Z8's plain text and keep its line breaks. */
function htmlText(value: string): string {
	return escapeHtml(value.trim()).replace(/\r?\n/g, "<br>");
}

function decimal(units: bigint, scale: number): number {
	return Number(formatUnits(units, scale));
}

export interface SaveInvoiceRequestInput {
	draft: InvoiceDraft;
	contactPersonId: string;
	hourUnityId: string;
	/** The invoice date: the hand-off day in Berlin (never before the period end). */
	invoiceDate: PlainDate;
	/** The Z8 marker written into `customerInternalNote` for idempotent lookups. */
	marker: string;
}

/** Builds the saveInvoice JSON text, or explains why sevdesk cannot take the draft. */
export function buildSaveInvoiceRequest(
	input: SaveInvoiceRequestInput,
): { ok: true; json: string } | { ok: false; message: string } {
	const { draft } = input;
	const tax = sevdeskTaxRule(draft.taxTreatment);
	if (!tax.ok) return tax;

	const footParts = [
		draft.remark?.trim() ? htmlText(draft.remark) : null,
		draft.lines.some((line) => line.kind === "text")
			? draft.lines
					.flatMap((line) => (line.kind === "text" ? [htmlText(line.text)] : []))
					.join("<br>")
			: null,
	].filter((part): part is string => part !== null);

	const invoicePosSave = draft.lines
		.flatMap((line) => (line.kind === "work" ? [line] : []))
		.map((line, index) => ({
			objectName: "InvoicePos",
			mapAll: true,
			quantity: decimal(BigInt(line.quantityHundredths), 2),
			price: decimal(line.unitPrice, 2),
			name: line.projectName,
			unity: { id: Number(input.hourUnityId), objectName: "Unity" },
			positionNumber: index + 1,
			text: line.text,
			taxRate: tax.rule.positionRate,
		}));

	const body = {
		invoice: {
			id: null,
			objectName: "Invoice",
			invoiceNumber: null,
			contact: { id: Number(draft.contactId), objectName: "Contact" },
			contactPerson: { id: Number(input.contactPersonId), objectName: "SevUser" },
			invoiceDate: formatSevdeskDate(input.invoiceDate),
			header: draft.title,
			headText: draft.introduction?.trim() ? htmlText(draft.introduction) : null,
			footText: footParts.length > 0 ? footParts.join("<br><br>") : null,
			discount: 0,
			deliveryDate: formatSevdeskDate(draft.servicePeriod.from),
			deliveryDateUntil: sevdeskTimestamp(draft.servicePeriod.to),
			status: "100",
			taxRate: 0,
			taxRule: { id: tax.rule.id, objectName: "TaxRule" },
			taxText: tax.rule.text,
			taxSet: null,
			invoiceType: "RE",
			currency: draft.currency,
			showNet: true,
			customerInternalNote: input.marker,
			mapAll: true,
		},
		invoicePosSave,
		invoicePosDelete: null,
		discountSave: null,
		discountDelete: null,
		takeDefaultAddress: true,
	};
	return { ok: true, json: JSON.stringify(body) };
}
