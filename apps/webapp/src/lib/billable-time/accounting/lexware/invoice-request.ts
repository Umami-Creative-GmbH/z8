/**
 * Translates Z8's provider-agnostic `InvoiceDraft` into the body of Lexware
 * Office's `POST /v1/invoices` (#904). Section "Invoices Endpoint" ("Invoice
 * Properties", "Line Items Details", "Tax Conditions Details", "Shipping
 * Conditions Details") and the FAQ "Texts in Sales Vouchers" of
 * https://developers.lexware.io/docs/ (read 2026-10-09).
 *
 * Pure. Money stays exact: cents become decimal strings first and only then
 * JSON numbers, which round-trip exactly at these sizes (≤ 15 significant digits).
 */

import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { formatUnits } from "@/lib/money/exact-decimal";
import type { InvoiceDraft, InvoiceDraftLine } from "../invoice-draft";
import { formatTaxRate, type TaxTreatmentKind } from "../tax-treatment";

/** Lexware runs on German time: voucher and service dates are midnight there. */
export const LEXWARE_TIME_ZONE = "Europe/Berlin";

/** "Texts in Sales Vouchers": maximum lengths of the text fields. */
export const LEXWARE_TEXT_LIMITS = Object.freeze({
	title: 25,
	introduction: 2000,
	remark: 2000,
	lineItemName: 255,
	lineItemDescription: 2000,
});

/** The unit of work lines; Lexware creates unknown unit names on the fly. */
export const LEXWARE_HOUR_UNIT = "Stunde";

/**
 * Z8 tax treatment → Lexware `taxConditions.taxType`. Hand-off lines are
 * services, so EU reverse charge is "Fremdleistungen innerhalb der EU gem.
 * §13b UStG" (`externalService13b`), not the goods type `intraCommunitySupply`.
 * Both non-domestic types need a referenced contact (the contact link), and
 * Lexware requires `taxRatePercentage` 0 on every non-taxed voucher.
 * The accountant checks the treatment on the draft (ADR 0002).
 */
export const LEXWARE_TAX_TYPES: Readonly<Record<TaxTreatmentKind, string>> = Object.freeze({
	domestic_standard: "net",
	domestic_reduced: "net",
	eu_reverse_charge: "externalService13b",
	third_country_service: "thirdPartyCountryService",
	vat_free: "vatfree",
});

const MAX_EXACT_DIGITS = 15;

/** A decimal string as a JSON number, refusing values a double cannot hold exactly. */
function exactNumber(decimal: string): number {
	if (decimal.replace(/[^0-9]/g, "").replace(/^0+/, "").length > MAX_EXACT_DIGITS) {
		throw new RangeError("Amount too large for Lexware Office");
	}
	return Number(decimal);
}

/**
 * Cuts `text` to `limit` UTF-16 code units (Lexware's Java string length),
 * ending with an ellipsis when it was longer; never splits a surrogate pair.
 */
export function shorten(text: string, limit: number): string {
	if (text.length <= limit) return text;
	let end = limit - 1;
	const last = text.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return `${text.slice(0, end)}…`;
}

/** Midnight of `date` in Lexware's zone, as `yyyy-MM-ddTHH:mm:ss.SSSXXX`. */
export function lexwareDateTime(date: PlainDate): string {
	const midnight = date.toZonedDateTime({ timeZone: LEXWARE_TIME_ZONE });
	return `${date.toString()}T00:00:00.000${midnight.offset}`;
}

/** Today in Lexware's zone. */
export function lexwareToday(now: Instant): PlainDate {
	return now.toZonedDateTimeISO(LEXWARE_TIME_ZONE).toPlainDate();
}

function lineItem(line: InvoiceDraftLine, taxRatePercentage: number): Record<string, unknown> {
	if (line.kind === "text") {
		const [first, ...rest] = line.text.split("\n");
		const description = rest.join("\n").trim();
		return {
			type: "text",
			name: shorten(
				first.trim() === "" ? line.text.trim() : first.trim(),
				LEXWARE_TEXT_LIMITS.lineItemName,
			),
			...(description === ""
				? {}
				: { description: shorten(description, LEXWARE_TEXT_LIMITS.lineItemDescription) }),
		};
	}
	return {
		type: "custom",
		name: shorten(line.projectName, LEXWARE_TEXT_LIMITS.lineItemName),
		description: shorten(line.text, LEXWARE_TEXT_LIMITS.lineItemDescription),
		quantity: exactNumber(formatUnits(BigInt(line.quantityHundredths), 2)),
		unitName: LEXWARE_HOUR_UNIT,
		unitPrice: {
			currency: "EUR",
			netAmount: exactNumber(formatUnits(line.unitPrice, 2)),
			taxRatePercentage,
		},
		discountPercentage: 0,
	};
}

/** The remark with Z8's marker as its last line, within Lexware's limit. */
export function markedRemark(remark: string | null, marker: string): string {
	const text = remark?.trim() ?? "";
	if (text === "") return marker;
	const separator = "\n\n";
	const room = LEXWARE_TEXT_LIMITS.remark - marker.length - separator.length;
	return `${shorten(text, room)}${separator}${marker}`;
}

/**
 * The `POST /v1/invoices` body for a draft. `marker` goes into the remark so a
 * retry can find the draft; `today` is the voucher date (the accountant sets
 * the final one when finalizing).
 */
export function lexwareInvoiceRequest(
	draft: InvoiceDraft,
	options: { marker: string; today: PlainDate },
): Record<string, unknown> {
	const taxed =
		draft.taxTreatment.kind === "domestic_standard" ||
		draft.taxTreatment.kind === "domestic_reduced";
	const taxRatePercentage = taxed
		? exactNumber(formatTaxRate(draft.taxTreatment.rateBasisPoints))
		: 0;
	const introduction = draft.introduction?.trim() ?? "";
	const title = draft.title.trim();
	return {
		archived: false,
		voucherDate: lexwareDateTime(options.today),
		address: { contactId: draft.contactId },
		lineItems: draft.lines.map((line) => lineItem(line, taxRatePercentage)),
		totalPrice: { currency: "EUR" },
		taxConditions: { taxType: LEXWARE_TAX_TYPES[draft.taxTreatment.kind] },
		shippingConditions: {
			shippingDate: lexwareDateTime(draft.servicePeriod.from),
			shippingEndDate: lexwareDateTime(draft.servicePeriod.to),
			shippingType: "serviceperiod",
		},
		...(title === "" ? {} : { title: shorten(title, LEXWARE_TEXT_LIMITS.title) }),
		...(introduction === ""
			? {}
			: { introduction: shorten(introduction, LEXWARE_TEXT_LIMITS.introduction) }),
		remark: markedRemark(draft.remark, options.marker),
	};
}
