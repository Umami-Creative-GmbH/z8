import "server-only";

import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { billableTimeSettings } from "@/db/schema/billable-time";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { type BillableCurrency, isBillableCurrency } from "./currency";
import { isBillableCurrencyLocked } from "./currency-lock";
import {
	type BillableTimeSettings,
	getBillableTimeSettings,
	lockBillableTimeSettings,
} from "./settings";

export type BillableTimeRefusal =
	| "organization_not_found"
	/** Billable Time needs projects. */
	| "projects_required"
	/** The first switch-on must choose a billable currency. */
	| "currency_required"
	| "invalid_currency"
	/** A billable rate or cost rate exists, so the currency is read-only. */
	| "currency_locked"
	/** The currency is changed in the Billable Time settings area, which needs the module on. */
	| "billable_time_off";

export type BillableTimeOutcome =
	| { ok: true; settings: BillableTimeSettings }
	| { ok: false; reason: BillableTimeRefusal };

const refuse = (reason: BillableTimeRefusal): BillableTimeOutcome => ({ ok: false, reason });

/**
 * Switches the Billable Time module on or off for one organization. The caller
 * authorizes the actor for `organizationId` first.
 *
 * - On: needs projects. The first time, it needs a listed billable currency;
 *   later it keeps the stored one. A different currency is a currency change and
 *   follows the read-only rule.
 * - Off: only clears the flag. The settings row and all module data stay.
 *
 * The organization row lock serializes this with the projects toggle, which
 * switches the module off with projects.
 */
export async function setBillableTimeEnabled(
	database: typeof db,
	input: {
		organizationId: string;
		enabled: boolean;
		currency?: string | null;
		actorUserId: string;
	},
): Promise<BillableTimeOutcome> {
	return database.transaction(async (tx) => {
		const [org] = await tx
			.select({ projectsEnabled: organization.projectsEnabled })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.limit(1)
			.for("update");
		if (!org) return refuse("organization_not_found");

		if (!input.enabled) {
			await setFlag(tx, input.organizationId, false);
			return { ok: true, settings: await getBillableTimeSettings(input.organizationId, tx) };
		}

		if (!org.projectsEnabled) return refuse("projects_required");
		const requested = input.currency ?? null;
		if (requested !== null && !isBillableCurrency(requested)) return refuse("invalid_currency");

		const current = await lockBillableTimeSettings(tx, input.organizationId, "update");
		if (current.currency === null) {
			if (requested === null) return refuse("currency_required");
			await tx.insert(billableTimeSettings).values({
				organizationId: input.organizationId,
				billableCurrency: requested,
				updatedBy: input.actorUserId,
			});
		} else if (requested !== null && requested !== current.currency) {
			const changed = await writeCurrency(tx, input.organizationId, requested, input.actorUserId);
			if (!changed.ok) return changed;
		}

		await setFlag(tx, input.organizationId, true);
		return { ok: true, settings: await getBillableTimeSettings(input.organizationId, tx) };
	});
}

/**
 * Changes the billable currency of an organization whose module is on, unless a
 * billable rate or cost rate already uses it. The caller authorizes the actor
 * for `organizationId` first.
 */
export async function changeBillableCurrency(
	database: typeof db,
	input: { organizationId: string; currency: string; actorUserId: string },
): Promise<BillableTimeOutcome> {
	if (!isBillableCurrency(input.currency)) return refuse("invalid_currency");
	const currency = input.currency;

	return database.transaction(async (tx) => {
		const current = await lockBillableTimeSettings(tx, input.organizationId, "update");
		if (!current.enabled) return refuse("billable_time_off");
		if (current.currency !== currency) {
			const changed = await writeCurrency(tx, input.organizationId, currency, input.actorUserId);
			if (!changed.ok) return changed;
		}
		return { ok: true, settings: await getBillableTimeSettings(input.organizationId, tx) };
	});
}

async function writeCurrency(
	tx: Transaction,
	organizationId: string,
	currency: BillableCurrency,
	actorUserId: string,
): Promise<{ ok: true } | { ok: false; reason: BillableTimeRefusal }> {
	if (await isBillableCurrencyLocked(tx, organizationId)) {
		return { ok: false, reason: "currency_locked" };
	}
	await tx
		.update(billableTimeSettings)
		.set({ billableCurrency: currency, updatedAt: sql`now()`, updatedBy: actorUserId })
		.where(eq(billableTimeSettings.organizationId, organizationId));
	return { ok: true };
}

async function setFlag(tx: Transaction, organizationId: string, enabled: boolean) {
	await tx
		.update(organization)
		.set({ billableTimeEnabled: enabled })
		.where(eq(organization.id, organizationId));
}
