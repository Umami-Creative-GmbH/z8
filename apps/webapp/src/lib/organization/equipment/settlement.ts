import { type SQL, sql } from "drizzle-orm";

/** An equipment assignment's return settlement: its terms and how its issued quantity is accounted for. */
export interface ReturnSettlement {
	quantity: number;
	returnRequired: boolean;
	/** Physically received, recoveries included. */
	received: number;
	lost: number;
	waived: number;
	/** Physically received against a loss or return waiver. */
	recovered: number;
}
export type SettlementTerms = Pick<ReturnSettlement, "quantity" | "returnRequired">;
export interface SettledReceipt {
	quantity: number;
	exceptionId: string | null;
}
export interface SettledException {
	id: string;
	kind: "lost" | "waived";
	quantity: number;
}
/** A loss or return waiver as recovery sees it: what it closed and what was physically received against it since. */
export interface DecisionRecovery {
	quantity: number;
	recovered: number;
}

/** The equipment_assignment columns that store a return settlement. */
export interface StoredSettlement {
	quantity: number;
	returnRequired: boolean;
	receivedQuantity: number;
	lostQuantity: number;
	waivedQuantity: number;
	exceptionReceivedQuantity: number;
}
export function assignmentSettlement(a: StoredSettlement): ReturnSettlement {
	return {
		quantity: a.quantity,
		returnRequired: a.returnRequired,
		received: a.receivedQuantity,
		lost: a.lostQuantity,
		waived: a.waivedQuantity,
		recovered: a.exceptionReceivedQuantity,
	};
}

/** The equipment_exception columns that store its recovery. */
export function exceptionRecovery(e: {
	quantity: number;
	receivedQuantity: number;
}): DecisionRecovery {
	return { quantity: e.quantity, recovered: e.receivedQuantity };
}

/** Every stored counter at once, so no writer computes one by hand. */
export function settlementColumns(s: ReturnSettlement) {
	return {
		receivedQuantity: s.received,
		lostQuantity: s.lost,
		waivedQuantity: s.waived,
		exceptionReceivedQuantity: s.recovered,
		received: isFullyReceived(s),
	};
}

/** `outstandingQuantity` for an equipment_assignment row in raw SQL; a Docker-DB test keeps the two in step. */
export function outstandingSql(alias: string): SQL {
	const a = sql.identifier(alias);
	return sql`(CASE WHEN ${a}.return_required THEN ${a}.quantity::bigint - ${a}.received_quantity - ${a}.lost_quantity - ${a}.waived_quantity + ${a}.exception_received_quantity ELSE 0 END)`;
}

export function outstandingQuantity(s: ReturnSettlement) {
	return s.returnRequired ? s.quantity - s.received - s.lost - s.waived + s.recovered : 0;
}

/** The most a normal receipt may take: the outstanding return, or what is still held when issued to keep. */
export function receivableQuantity(s: ReturnSettlement) {
	return s.returnRequired ? outstandingQuantity(s) : s.quantity - s.received;
}

export function isFullyReceived(s: ReturnSettlement) {
	return s.received === s.quantity;
}

/** What can still be physically received against a loss or return waiver; never negative when valid. */
export function recoverableQuantity(decision: DecisionRecovery) {
	return decision.quantity - decision.recovered;
}

/**
 * The one return settlement invariant. The database's equipment_assignment_settlement_check
 * and equipment_assignment_received_check constraints mirror it; keep them in step.
 */
export function settlementViolation(
	s: ReturnSettlement,
	decisions: readonly DecisionRecovery[] = [],
): "recovery_conflict" | "return_not_required" | "excess_quantity" | null {
	if (decisions.some((decision) => recoverableQuantity(decision) < 0)) return "recovery_conflict";
	if (!s.returnRequired && (s.lost > 0 || s.waived > 0)) return "return_not_required";
	const validQuantities =
		s.received >= 0 &&
		s.lost >= 0 &&
		s.waived >= 0 &&
		s.recovered >= 0 &&
		s.received <= s.quantity &&
		s.recovered <= s.received &&
		s.recovered <= s.lost + s.waived &&
		outstandingQuantity(s) >= 0;
	return validQuantities ? null : "excess_quantity";
}

export type SettleOutcome =
	| {
			ok: true;
			settlement: ReturnSettlement;
			/** Physically received against each decision, keyed by exception id. */
			recoveredByException: Map<string, number>;
	  }
	| { ok: false; reason: "excess_quantity" | "recovery_conflict" };

/** Settles effective records in any order. Callers validate receipt links before replay. */
export function settle(
	terms: SettlementTerms,
	receipts: readonly SettledReceipt[],
	exceptions: readonly SettledException[],
): SettleOutcome {
	const settlement: ReturnSettlement = {
		quantity: terms.quantity,
		returnRequired: terms.returnRequired,
		received: 0,
		lost: 0,
		waived: 0,
		recovered: 0,
	};
	const recoveredByException = new Map<string, number>();
	for (const { quantity, exceptionId } of receipts) {
		settlement.received += quantity;
		if (exceptionId !== null) {
			settlement.recovered += quantity;
			recoveredByException.set(
				exceptionId,
				(recoveredByException.get(exceptionId) ?? 0) + quantity,
			);
		}
	}
	const decisions: DecisionRecovery[] = [];
	for (const { id, kind, quantity } of exceptions) {
		settlement[kind] += quantity;
		const recovered = recoveredByException.get(id) ?? 0;
		recoveredByException.set(id, recovered);
		decisions.push({ quantity, recovered });
	}
	const violation = settlementViolation(settlement, decisions);
	if (violation)
		return {
			ok: false,
			reason: violation === "recovery_conflict" ? violation : "excess_quantity",
		};
	return { ok: true, settlement, recoveredByException };
}

export type ApplyOutcome<Reason extends string> =
	| { ok: true; settlement: ReturnSettlement }
	| { ok: false; reason: Reason };

export type ReceiptOutcome =
	| {
			ok: true;
			settlement: ReturnSettlement;
			/** The decision's recovery after this receipt, when it was one. */
			recovery: DecisionRecovery | null;
	  }
	| { ok: false; reason: "excess_quantity" };

/** One physical receipt; with a decision, it is a recovery against that loss or return waiver. */
export function applyReceipt(
	s: ReturnSettlement,
	quantity: number,
	decision?: DecisionRecovery,
): ReceiptOutcome {
	const recovery = decision ? { ...decision, recovered: decision.recovered + quantity } : null;
	const settlement = {
		...s,
		received: s.received + quantity,
		recovered: s.recovered + (recovery ? quantity : 0),
	};
	return settlementViolation(settlement, recovery ? [recovery] : [])
		? { ok: false, reason: "excess_quantity" }
		: { ok: true, settlement, recovery };
}

/** Closes part of the outstanding return as lost or return waived. */
export function applyClosure(
	s: ReturnSettlement,
	outcome: "lost" | "waived",
	quantity: number,
): ApplyOutcome<"excess_quantity" | "return_not_required"> {
	if (!s.returnRequired) return { ok: false, reason: "return_not_required" };
	const settlement = { ...s, [outcome]: s[outcome] + quantity };
	return settlementViolation(settlement)
		? { ok: false, reason: "excess_quantity" }
		: { ok: true, settlement };
}
