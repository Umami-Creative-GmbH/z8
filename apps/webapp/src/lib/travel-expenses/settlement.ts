import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	currencyMinorUnitDigits,
	formatUnits,
	MAX_AMOUNT_UNITS,
	parseUnits,
	STORED_AMOUNT_SCALE,
	sumUnits,
} from "./money";
import { isSupportedCurrency } from "./receipt-report";
import { SETTLEMENT_ENTRY_KINDS, type SettlementEntryKind } from "./settlement.types";

/**
 * The settlement account of one approved expense source (#612): a travel
 * expense report, or an approved legacy claim. Z8 never moves money; finance
 * records what happened and the balance is derived, never stored:
 *
 *   effective entitlement = Σ entitlement components (signed)
 *   balance               = entitlement − Σ reimbursements + Σ recoveries
 *
 * A positive balance is outstanding reimbursement, a negative balance is an
 * overpayment shown as such (never clamped), zero is settled. Amounts are
 * exact integer units and every currency keeps its own line: unlike
 * currencies are never added together.
 *
 * Extension points (see NOTES/progress-612.md):
 * - `EntitlementComponent.kind = "approved_adjustment"` (#615): each approved
 *   signed adjustment is one more component, counted exactly once.
 * - `SettlementEntryKind = "recovery"` (#615): money recovered from the
 *   employee; `planSettlementEntry` already admits it only against an
 *   overpayment.
 * Export batches (#613) are not money: they never change a balance.
 */

export { SETTLEMENT_ENTRY_KINDS, type SettlementEntryKind } from "./settlement.types";

export interface EntitlementComponent {
	/**
	 * `approved_submission`: the employee-paid total of a report's approved
	 * frozen revision. `legacy_claim`: an approved legacy claim's calculated
	 * amount. `approved_adjustment` (#615): a signed delta.
	 */
	kind: "approved_submission" | "legacy_claim" | "approved_adjustment";
	/** The revision, claim or adjustment the amount comes from. */
	id: string;
	currency: string;
	/** Signed decimal at the stored scale ("-50.00"). */
	amount: string;
}

export interface SettlementEntryAmount {
	kind: SettlementEntryKind;
	currency: string;
	/** Always positive; the kind gives the direction. */
	amount: string;
}

export type SettlementState = "settled" | "outstanding" | "overpaid";

export interface CurrencySettlement {
	currency: string;
	entitlement: string;
	reimbursed: string;
	recovered: string;
	/** Signed: entitlement − reimbursed + recovered. */
	balance: string;
	state: SettlementState;
}

export interface SettlementSummary {
	/** One line per currency, ordered by currency code. */
	currencies: CurrencySettlement[];
	/** `mixed` when currencies disagree (one outstanding, another overpaid). */
	state: SettlementState | "mixed";
}

const ZERO = BigInt(0);

function storedUnits(value: string): bigint {
	const units = parseUnits(value, STORED_AMOUNT_SCALE);
	if (units === null) throw new RangeError(`Not a stored amount: ${value}`);
	return units;
}

function stateOf(balance: bigint): SettlementState {
	if (balance > ZERO) return "outstanding";
	if (balance < ZERO) return "overpaid";
	return "settled";
}

export function computeSettlement(input: {
	entitlement: readonly EntitlementComponent[];
	entries: readonly SettlementEntryAmount[];
}): SettlementSummary {
	const lines = new Map<
		string,
		{ entitlement: bigint[]; reimbursed: bigint[]; recovered: bigint[] }
	>();
	const line = (currency: string) => {
		let current = lines.get(currency);
		if (!current) {
			current = { entitlement: [], reimbursed: [], recovered: [] };
			lines.set(currency, current);
		}
		return current;
	};
	for (const component of input.entitlement) {
		line(component.currency).entitlement.push(storedUnits(component.amount));
	}
	for (const entry of input.entries) {
		const units = storedUnits(entry.amount);
		if (units <= ZERO) throw new RangeError(`Settlement entries are positive: ${entry.amount}`);
		const target = line(entry.currency);
		(entry.kind === "reimbursement" ? target.reimbursed : target.recovered).push(units);
	}
	const currencies = [...lines.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([currency, values]): CurrencySettlement => {
			const entitlement = sumUnits(values.entitlement);
			const reimbursedUnits = sumUnits(values.reimbursed);
			const recoveredUnits = sumUnits(values.recovered);
			const balance = entitlement - reimbursedUnits + recoveredUnits;
			return {
				currency,
				entitlement: formatUnits(entitlement, STORED_AMOUNT_SCALE),
				reimbursed: formatUnits(reimbursedUnits, STORED_AMOUNT_SCALE),
				recovered: formatUnits(recoveredUnits, STORED_AMOUNT_SCALE),
				balance: formatUnits(balance, STORED_AMOUNT_SCALE),
				state: stateOf(balance),
			};
		});
	const open = [
		...new Set(currencies.map((currency) => currency.state).filter((s) => s !== "settled")),
	];
	const state: SettlementSummary["state"] = open.length > 1 ? "mixed" : (open[0] ?? "settled");
	return { currencies, state };
}

/** A validated, normalized command to record money that moved outside Z8. */
export interface SettlementCommand {
	kind: SettlementEntryKind;
	/** Positive, at the stored scale ("120.50"). */
	amount: string;
	currency: string;
	/** Calendar date the money moved, as entered; no zone is applied. */
	occurredOn: string;
	/** Bank or payment reference, trimmed. */
	reference: string;
	note: string | null;
}

export interface SettlementCommandInput {
	kind: string;
	amount: string;
	currency: string;
	occurredOn: string;
	reference: string;
	note?: string | null;
}

export type SettlementCommandField = keyof SettlementCommand;
export interface SettlementCommandFieldError {
	field: SettlementCommandField;
	code: "required" | "invalid" | "precision" | "future" | "too_long";
}

export const SETTLEMENT_REFERENCE_MAX_LENGTH = 200;
export const SETTLEMENT_NOTE_MAX_LENGTH = 1000;
const EARLIEST_DATE = "2000-01-01";

function plainDate(value: string): PlainDate | null {
	try {
		return parsePlainDate(value);
	} catch {
		return null;
	}
}

export function parseSettlementCommand(
	input: SettlementCommandInput,
	context: { latestDate: string },
): { ok: true; command: SettlementCommand } | { ok: false; errors: SettlementCommandFieldError[] } {
	const errors: SettlementCommandFieldError[] = [];
	const kind = (SETTLEMENT_ENTRY_KINDS as readonly string[]).includes(input.kind)
		? (input.kind as SettlementEntryKind)
		: null;
	if (!kind) errors.push({ field: "kind", code: "invalid" });

	const currency = input.currency.trim();
	const currencyValid = /^[A-Z]{3}$/.test(currency) && isSupportedCurrency(currency);
	const amountText = input.amount.trim();
	const units = parseUnits(amountText, STORED_AMOUNT_SCALE);
	if (!amountText) errors.push({ field: "amount", code: "required" });
	else if (units === null && parseUnits(amountText, 40) !== null) {
		errors.push({ field: "amount", code: "precision" });
	} else if (units === null || units <= ZERO || units > MAX_AMOUNT_UNITS) {
		errors.push({ field: "amount", code: "invalid" });
	} else if (currencyValid && parseUnits(amountText, currencyMinorUnitDigits(currency)) === null) {
		errors.push({ field: "amount", code: "precision" });
	}
	if (!currencyValid) errors.push({ field: "currency", code: "invalid" });

	const occurredOn = plainDate(input.occurredOn.trim());
	const latest = plainDate(context.latestDate);
	if (!input.occurredOn.trim()) errors.push({ field: "occurredOn", code: "required" });
	else if (!occurredOn || comparePlainDates(occurredOn, parsePlainDate(EARLIEST_DATE)) < 0) {
		errors.push({ field: "occurredOn", code: "invalid" });
	} else if (latest && comparePlainDates(occurredOn, latest) > 0) {
		errors.push({ field: "occurredOn", code: "future" });
	}

	const reference = input.reference.trim();
	if (!reference) errors.push({ field: "reference", code: "required" });
	else if (reference.length > SETTLEMENT_REFERENCE_MAX_LENGTH) {
		errors.push({ field: "reference", code: "too_long" });
	}
	const note = input.note?.trim() || null;
	if (note && note.length > SETTLEMENT_NOTE_MAX_LENGTH) {
		errors.push({ field: "note", code: "too_long" });
	}

	if (errors.length > 0 || !kind || units === null || !occurredOn) return { ok: false, errors };
	return {
		ok: true,
		command: {
			kind,
			amount: formatUnits(units, STORED_AMOUNT_SCALE),
			currency,
			occurredOn: occurredOn.toString(),
			reference,
			note,
		},
	};
}

export type SettlementPlanRefusal =
	/** The balance finance saw is no longer the balance: reload and decide again. */
	| "stale_balance"
	/** Money is recorded only in a currency the account is entitled in. */
	| "currency_mismatch"
	| "nothing_outstanding"
	| "exceeds_outstanding"
	| "no_overpayment"
	| "exceeds_overpayment";

/**
 * Checks one command against the current account. `expectedBalance` is the
 * balance the person recording saw: if anything changed since (another
 * reimbursement, an adjustment), the command is refused instead of applied to
 * a balance nobody looked at. A reimbursement never exceeds what is
 * outstanding; a recovery never exceeds the overpayment.
 */
export function planSettlementEntry(
	summary: SettlementSummary,
	command: Pick<SettlementCommand, "kind" | "amount" | "currency">,
	expectedBalance: { currency: string; amount: string },
):
	| { ok: true; balanceBefore: string; balanceAfter: string }
	| { ok: false; reason: SettlementPlanRefusal; balance: string } {
	const line = summary.currencies.find((entry) => entry.currency === expectedBalance.currency);
	const balance = line ? storedUnits(line.balance) : ZERO;
	const balanceText = formatUnits(balance, STORED_AMOUNT_SCALE);
	const refuse = (reason: SettlementPlanRefusal) => ({
		ok: false as const,
		reason,
		balance: balanceText,
	});
	const expected = parseUnits(expectedBalance.amount, STORED_AMOUNT_SCALE);
	if (expected === null || expected !== balance) return refuse("stale_balance");
	if (!line || command.currency !== line.currency) return refuse("currency_mismatch");
	const amount = storedUnits(command.amount);
	if (amount <= ZERO) throw new RangeError("Settlement amounts are positive");
	if (command.kind === "reimbursement") {
		if (balance <= ZERO) return refuse("nothing_outstanding");
		if (amount > balance) return refuse("exceeds_outstanding");
	} else {
		if (balance >= ZERO) return refuse("no_overpayment");
		if (amount > -balance) return refuse("exceeds_overpayment");
	}
	const after = command.kind === "reimbursement" ? balance - amount : balance + amount;
	return {
		ok: true,
		balanceBefore: balanceText,
		balanceAfter: formatUnits(after, STORED_AMOUNT_SCALE),
	};
}
