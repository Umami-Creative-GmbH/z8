/**
 * The pages of the Billable Time settings area (#897), in navigation order.
 * Later slices of #768 add theirs here (billable rates #898, cost rates #899,
 * accounting connection #903) and gate each page with
 * `requireBillableTimeSettingsAccess()`.
 */
export const BILLABLE_TIME_SETTINGS_PAGES = [
	{
		id: "currency",
		href: "/settings/billable-time",
		titleKey: "settings.billableTime.nav.currency",
		titleDefault: "Billable currency",
	},
	{
		id: "rates",
		href: "/settings/billable-time/rates",
		titleKey: "settings.billableTime.nav.rates",
		titleDefault: "Billable rates",
	},
	{
		id: "cost-rates",
		href: "/settings/billable-time/cost-rates",
		titleKey: "settings.billableTime.nav.costRates",
		titleDefault: "Cost rates",
	},
] as const satisfies readonly {
	id: string;
	href: `/settings/billable-time${string}`;
	titleKey: string;
	titleDefault: string;
}[];

export type BillableTimeSettingsPageId = (typeof BILLABLE_TIME_SETTINGS_PAGES)[number]["id"];
