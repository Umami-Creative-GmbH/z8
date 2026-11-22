/**
 * The configuration pages of the Billable Time settings area (#897, #1956),
 * in navigation order. Each page is gated with `requireBillableTimeSettingsAccess()`.
 */
export const BILLABLE_TIME_SETTINGS_PAGES = [
	{
		id: "rates",
		href: "/settings/billable-time",
		titleKey: "settings.billableTime.nav.rates",
		titleDefault: "Billable rates",
	},
	{
		id: "cost-rates",
		href: "/settings/billable-time/cost-rates",
		titleKey: "settings.billableTime.nav.costRates",
		titleDefault: "Cost rates",
	},
	{
		id: "accounting",
		href: "/settings/billable-time/accounting",
		titleKey: "settings.billableTime.nav.accounting",
		titleDefault: "Accounting",
	},
] as const satisfies readonly {
	id: string;
	href: `/settings/billable-time${string}`;
	titleKey: string;
	titleDefault: string;
}[];

export type BillableTimeSettingsPageId = (typeof BILLABLE_TIME_SETTINGS_PAGES)[number]["id"];
