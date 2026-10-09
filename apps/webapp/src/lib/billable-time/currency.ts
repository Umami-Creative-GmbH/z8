/**
 * The billable currencies an organization can choose (#897). One currency per
 * organization, no FX: every billable rate, cost rate, revenue and margin is in
 * it. Keep this list in sync with `billable_time_settings_currency_check`.
 *
 * Client-safe: the settings UI imports it for its currency picker.
 */
export const BILLABLE_CURRENCIES = ["EUR", "CHF", "USD", "GBP"] as const;

export type BillableCurrency = (typeof BILLABLE_CURRENCIES)[number];

export const DEFAULT_BILLABLE_CURRENCY: BillableCurrency = "EUR";

export function isBillableCurrency(value: unknown): value is BillableCurrency {
	return typeof value === "string" && (BILLABLE_CURRENCIES as readonly string[]).includes(value);
}
