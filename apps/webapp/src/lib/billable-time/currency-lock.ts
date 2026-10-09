import "server-only";

import {
	BILLABLE_CURRENCY_LOCK_PROBES,
	type BillableCurrencyLockClient,
	type BillableCurrencyLockProbe,
} from "./currency-lock-probes";

/**
 * The read-only rule for the billable currency (#897): once any record priced in
 * it exists (a billable rate or a cost rate), the currency can no longer change.
 * Changing it would silently reprice those records in another currency.
 *
 * Call it inside the transaction that changes the currency, after
 * `lockBillableTimeSettings(tx, organizationId, "update")`.
 */
export async function isBillableCurrencyLocked(
	tx: BillableCurrencyLockClient,
	organizationId: string,
	probes: readonly BillableCurrencyLockProbe[] = BILLABLE_CURRENCY_LOCK_PROBES,
): Promise<boolean> {
	for (const probe of probes) {
		if (await probe.hasPricedRows(tx, organizationId)) {
			return true;
		}
	}
	return false;
}
