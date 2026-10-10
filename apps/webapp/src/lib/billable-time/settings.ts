import "server-only";

import { eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { billableTimeSettings } from "@/db/schema/billable-time";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { type BillableCurrency, isBillableCurrency } from "./currency";

/**
 * An organization's Billable Time settings (#897).
 *
 * - `enabled`: the module is switched on. It is never true while projects are
 *   off, even if a stale flag says so, or before a currency was chosen.
 * - `currency`: the billable currency, or `null` until the module was first
 *   switched on. Switching the module off keeps it.
 */
export interface BillableTimeSettings {
	enabled: boolean;
	currency: BillableCurrency | null;
}

export type BillableTimeSettingsReader = Pick<Transaction, "select">;

/** Thrown by `requireBillableTimeEnabled` when the module is off for the organization. */
export class BillableTimeDisabledError extends Error {
	constructor(readonly organizationId: string) {
		super("Billable Time is not enabled for this organization");
		this.name = "BillableTimeDisabledError";
	}
}

/**
 * Reads one organization's Billable Time settings. Callers pass the organization
 * they have already authorized (normally the active organization). An unknown
 * organization reads as switched off.
 */
export async function getBillableTimeSettings(
	organizationId: string,
	reader: BillableTimeSettingsReader,
): Promise<BillableTimeSettings> {
	const [row] = await reader
		.select({
			billableTimeEnabled: organization.billableTimeEnabled,
			projectsEnabled: organization.projectsEnabled,
			billableCurrency: billableTimeSettings.billableCurrency,
		})
		.from(organization)
		.leftJoin(billableTimeSettings, eq(billableTimeSettings.organizationId, organization.id))
		.where(eq(organization.id, organizationId))
		.limit(1);

	return settingsFromRow(row);
}

/**
 * The billable currency of an organization whose module is on. Later slices
 * (rates, reports, hand-off) call this before reading or writing priced data.
 */
export async function requireBillableTimeEnabled(
	organizationId: string,
	reader: BillableTimeSettingsReader,
): Promise<{ currency: BillableCurrency }> {
	const settings = await getBillableTimeSettings(organizationId, reader);
	if (!settings.enabled || settings.currency === null) {
		throw new BillableTimeDisabledError(organizationId);
	}
	return { currency: settings.currency };
}

/**
 * Locks the organization's settings row inside `tx` and returns its settings.
 *
 * Writers of anything priced in the billable currency (billable rates, cost
 * rates) call this first with `"share"`, so that a concurrent currency change
 * (which locks `"update"`) either sees their row or waits for it. Returns
 * `{ enabled: false, currency: null }` when the module was never switched on.
 */
export async function lockBillableTimeSettings(
	tx: BillableTimeSettingsReader,
	organizationId: string,
	strength: "share" | "update" = "share",
): Promise<BillableTimeSettings> {
	// Postgres cannot lock the nullable side of an outer join: lock the settings
	// row on its own, then read the flags.
	const [locked] = await tx
		.select({ billableCurrency: billableTimeSettings.billableCurrency })
		.from(billableTimeSettings)
		.where(eq(billableTimeSettings.organizationId, organizationId))
		.limit(1)
		.for(strength);
	const [flags] = await tx
		.select({
			billableTimeEnabled: organization.billableTimeEnabled,
			projectsEnabled: organization.projectsEnabled,
		})
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);

	return settingsFromRow(flags && { ...flags, billableCurrency: locked?.billableCurrency ?? null });
}

function settingsFromRow(
	row:
		| {
				billableTimeEnabled: boolean | null;
				projectsEnabled: boolean | null;
				billableCurrency: string | null;
		  }
		| undefined,
): BillableTimeSettings {
	const currency = isBillableCurrency(row?.billableCurrency) ? row.billableCurrency : null;
	return {
		enabled:
			(row?.billableTimeEnabled ?? false) && (row?.projectsEnabled ?? false) && currency !== null,
		currency,
	};
}
