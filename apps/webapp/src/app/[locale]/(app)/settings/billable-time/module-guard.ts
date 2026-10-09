import { Effect } from "effect";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";

/**
 * Shared guards and refusals of the Billable Time settings actions (rates,
 * accounting connection, hand-off): the module switch and the accounting
 * connection's provider refusals, worded once.
 */

export const billableTimeOff = () =>
	new ValidationError({ message: "Billable Time is switched off", field: "billableTimeEnabled" });

/** Fails with `billableTimeOff` unless the module is on with a billable currency. */
export function requireBillableTimeOn(organizationId: string, queryName: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query(queryName, () =>
			getBillableTimeSettings(organizationId, dbService.db),
		);
		if (!settings.enabled || settings.currency === null) {
			return yield* Effect.fail(billableTimeOff());
		}
		return { currency: settings.currency };
	});
}

/** Why the accounting connection's provider cannot be used right now. */
export type AccountingProviderRefusal =
	| "not_connected"
	| "provider_unavailable"
	| "credentials_missing"
	| "credentials_refused";

const PROVIDER_REFUSAL_MESSAGES: Record<AccountingProviderRefusal, string> = {
	not_connected: "Connect an accounting tool first",
	provider_unavailable: "The connected accounting tool is not available in this installation",
	credentials_missing:
		"The API key of the accounting connection is missing. Replace the connection",
	credentials_refused: "The accounting tool refused the stored API key. Replace the connection",
};

/** The clear message for a provider refusal (also used for hand-off blockers). */
export function accountingProviderRefusalMessage(reason: AccountingProviderRefusal): string {
	return PROVIDER_REFUSAL_MESSAGES[reason];
}

export function accountingProviderRefusalError(reason: AccountingProviderRefusal) {
	return new ValidationError({
		message: accountingProviderRefusalMessage(reason),
		field: "accountingConnection",
	});
}
