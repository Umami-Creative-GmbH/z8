import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";

/** The client a probe reads through: the transaction that changes the currency. */
export type BillableCurrencyLockClient = Pick<Transaction, "select" | "execute">;

/**
 * One kind of record priced in the billable currency. While any probe finds a
 * row for the organization, the billable currency is read-only (#897).
 */
export interface BillableCurrencyLockProbe {
	readonly name: string;
	hasPricedRows(tx: BillableCurrencyLockClient, organizationId: string): Promise<boolean>;
}

/**
 * Every record kind that fixes the billable currency. Register a probe here when
 * a table stores amounts in it:
 *
 * - billable rates (#898)
 * - cost rates (#899)
 *
 * A probe must filter by `organizationId`. Writers of those tables take
 * `lockBillableTimeSettings` in their transaction first, so a concurrent currency
 * change either sees their row or waits for it.
 */
export const BILLABLE_CURRENCY_LOCK_PROBES: readonly BillableCurrencyLockProbe[] = [];
