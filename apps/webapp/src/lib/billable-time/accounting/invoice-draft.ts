/**
 * The provider-agnostic invoice draft (#903): what one hand-off asks the
 * accounting tool to create. Each connector translates it into its tool's
 * request (Lexware `POST /v1/invoices`, sevdesk `saveInvoice`).
 *
 * Quantities and amounts follow the hand-off rule: a work line states its exact
 * recorded duration as hours with two decimals (half up), and its amount is
 * those hours times the unit price, rounded half up to the cent. That is what
 * the tool computes from the line, so the draft's total in the tool equals the
 * sum Z8 shows in the preview. Money is integer cents (`bigint`), never floats.
 *
 * Client-safe and pure.
 */

import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { RateUnits } from "@/lib/billable-time/money";
import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import { divideToUnits, formatUnits, sumUnits } from "@/lib/money/exact-decimal";
import type { AccountingProviderCapabilities } from "./provider";
import type { TaxTreatment, TaxTreatmentKind } from "./tax-treatment";

const MILLISECONDS_PER_HOUR = BigInt(3_600_000);

/** One line of billable work: one project at one applicable rate. */
export interface InvoiceDraftWorkLine {
	kind: "work";
	projectId: string;
	projectName: string;
	/** The line text: project, period and hours. */
	text: string;
	/** The exact recorded duration behind the line, in whole milliseconds. */
	durationMs: number;
	/** The stated quantity: hours × 100, rounded half up from `durationMs`. */
	quantityHundredths: number;
	/** Net price per hour in cents of the draft currency (the applicable rate, frozen). */
	unitPrice: RateUnits;
	/** Net amount in cents: quantity × unit price, rounded half up. */
	amount: bigint;
}

/** A text-only line, e.g. the optional timesheet summary. */
export interface InvoiceDraftTextLine {
	kind: "text";
	text: string;
}

export type InvoiceDraftLine = InvoiceDraftWorkLine | InvoiceDraftTextLine;

export interface InvoiceDraft {
	/** The tool's contact id from the customer's contact link. */
	contactId: string;
	currency: BillableCurrency;
	taxTreatment: TaxTreatment;
	/** The hand-off period, both days inclusive. */
	servicePeriod: { from: PlainDate; to: PlainDate };
	/** Z8's texts; connectors shorten them to their tool's limits. */
	title: string;
	introduction: string | null;
	remark: string | null;
	lines: readonly InvoiceDraftLine[];
}

export type InvoiceDraftInput = InvoiceDraft;

export type InvoiceDraftProblem =
	| "missing_contact"
	| "no_work_lines"
	| "invalid_line"
	| "invalid_service_period";

/** A work line priced by the hand-off rule from its exact duration and rate. */
export function workLine(input: {
	projectId: string;
	projectName: string;
	text: string;
	durationMs: number;
	unitPrice: RateUnits;
}): InvoiceDraftWorkLine {
	const durationMs = Number.isSafeInteger(input.durationMs) ? input.durationMs : Number.NaN;
	const quantityHundredths = Number.isNaN(durationMs)
		? Number.NaN
		: Number(
				divideToUnits(
					{ units: BigInt(durationMs), scale: 0 },
					{ units: MILLISECONDS_PER_HOUR, scale: 0 },
					2,
					"half_up",
				),
			);
	const amount = Number.isNaN(quantityHundredths)
		? BigInt(0)
		: divideToUnits(
				{ units: BigInt(quantityHundredths) * input.unitPrice, scale: 2 },
				"1",
				0,
				"half_up",
			);
	return {
		kind: "work",
		projectId: input.projectId,
		projectName: input.projectName,
		text: input.text,
		durationMs,
		quantityHundredths,
		unitPrice: input.unitPrice,
		amount,
	};
}

/** A work line's quantity as hours with two decimals: "1.50". */
export function formatQuantityHours(
	line: Pick<InvoiceDraftWorkLine, "quantityHundredths">,
): string {
	return formatUnits(BigInt(line.quantityHundredths), 2);
}

function validLine(line: InvoiceDraftLine): boolean {
	if (line.text.trim() === "") return false;
	if (line.kind === "text") return true;
	return (
		Number.isSafeInteger(line.durationMs) &&
		line.durationMs > 0 &&
		line.quantityHundredths > 0 &&
		line.unitPrice > BigInt(0) &&
		line.projectId !== ""
	);
}

/**
 * Validates a draft for a hand-off: a contact, at least one work line, sound
 * lines and a service period that does not end before it starts.
 */
export function buildInvoiceDraft(
	input: InvoiceDraftInput,
): { ok: true; draft: InvoiceDraft } | { ok: false; problem: InvoiceDraftProblem } {
	if (input.contactId.trim() === "") return { ok: false, problem: "missing_contact" };
	if (!input.lines.some((line) => line.kind === "work")) {
		return { ok: false, problem: "no_work_lines" };
	}
	if (!input.lines.every(validLine)) return { ok: false, problem: "invalid_line" };
	if (comparePlainDates(input.servicePeriod.from, input.servicePeriod.to) > 0) {
		return { ok: false, problem: "invalid_service_period" };
	}
	return { ok: true, draft: { ...input, lines: [...input.lines] } };
}

/** The draft's net total in cents: the sum of its work line amounts. */
export function invoiceDraftNetTotal(draft: Pick<InvoiceDraft, "lines">): bigint {
	return sumUnits(draft.lines.flatMap((line) => (line.kind === "work" ? [line.amount] : [])));
}

export type InvoiceDraftCapabilityProblem =
	| { problem: "too_many_lines"; lines: number; maxDraftLines: number }
	| { problem: "currency_not_supported"; currency: BillableCurrency }
	| { problem: "tax_treatment_not_supported"; taxTreatment: TaxTreatmentKind };

/** Everything about a draft the provider declared it cannot take. Empty when it fits. */
export function checkInvoiceDraftFits(
	draft: InvoiceDraft,
	capabilities: AccountingProviderCapabilities,
): InvoiceDraftCapabilityProblem[] {
	const problems: InvoiceDraftCapabilityProblem[] = [];
	if (draft.lines.length > capabilities.maxDraftLines) {
		problems.push({
			problem: "too_many_lines",
			lines: draft.lines.length,
			maxDraftLines: capabilities.maxDraftLines,
		});
	}
	if (!capabilities.supportedCurrencies.includes(draft.currency)) {
		problems.push({ problem: "currency_not_supported", currency: draft.currency });
	}
	if (!capabilities.supportedTaxTreatments.includes(draft.taxTreatment.kind)) {
		problems.push({
			problem: "tax_treatment_not_supported",
			taxTreatment: draft.taxTreatment.kind,
		});
	}
	return problems;
}
