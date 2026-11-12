"use server";

import { Effect } from "effect";
import { z } from "zod";
import type { AccountingProviderKind } from "@/lib/billable-time/accounting/provider";
import { accountingProviderName } from "@/lib/billable-time/accounting/views";
import {
	type BillableTimeOutcome,
	type BillableTimeRefusal,
	changeBillableCurrency,
	setBillableTimeEnabled,
} from "@/lib/billable-time/module-switch";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { billableTimeOff } from "./module-guard";

const logger = createLogger("BillableTimeSettingsActions");

function refusalError(
	reason: BillableTimeRefusal,
	organizationId: string,
	accountingProvider?: AccountingProviderKind,
) {
	switch (reason) {
		case "organization_not_found":
			return new NotFoundError({
				message: "Organization not found",
				entityType: "organization",
				entityId: organizationId,
			});
		case "projects_required":
			return new ValidationError({
				message: "Switch on projects before Billable Time",
				field: "billableTimeEnabled",
			});
		case "currency_required":
			return new ValidationError({
				message: "Choose a billable currency to switch on Billable Time",
				field: "currency",
			});
		case "invalid_currency":
			return new ValidationError({
				message: "Choose one of the listed billable currencies",
				field: "currency",
			});
		case "currency_locked":
			return new ConflictError({
				message: "The billable currency can't change once billable rates or cost rates exist",
				conflictType: "billable_currency_locked",
			});
		case "currency_not_supported_by_accounting": {
			const tool = accountingProvider
				? accountingProviderName(accountingProvider)
				: "The connected accounting tool";
			return new ConflictError({
				message: `${tool} can't take invoice drafts in this currency. Remove or replace the accounting connection before changing the billable currency`,
				conflictType: "billable_currency_accounting",
			});
		}
		case "billable_time_off":
			return billableTimeOff();
	}
}

const settingsOf = (outcome: BillableTimeOutcome, organizationId: string) =>
	outcome.ok
		? Effect.succeed(outcome.settings)
		: Effect.fail(refusalError(outcome.reason, organizationId, outcome.accountingProvider));

/**
 * Switches the Billable Time module of the active organization. Like every
 * module switch on the organization features card, it is the owner's. The first
 * switch-on must choose a billable currency; switching off keeps all data.
 */
export const switchBillableTime = organizationAction(
	{
		name: "billableTime.switch",
		requires: "owner",
		schema: z.strictObject({
			enabled: z.boolean(),
			currency: z.string().max(10).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("billableTime.switch", () =>
				setBillableTimeEnabled(dbService.db, {
					organizationId,
					enabled: input.enabled,
					currency: input.currency ?? null,
					actorUserId: actor.userId,
				}),
			);
			const settings = yield* settingsOf(outcome, organizationId);
			logger.info(
				{ organizationId, enabled: settings.enabled },
				`Billable Time ${settings.enabled ? "enabled" : "disabled"}`,
			);
			return settings;
		}),
);

/**
 * Changes the billable currency of the active organization. Org admins may do it
 * while the module is on and no billable rate or cost rate exists yet.
 */
export const updateBillableCurrency = organizationAction(
	{
		name: "billableTime.updateCurrency",
		requires: "orgAdmin",
		schema: z.strictObject({ currency: z.string().max(10) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("billableTime.updateCurrency", () =>
				changeBillableCurrency(dbService.db, {
					organizationId,
					currency: input.currency,
					actorUserId: actor.userId,
				}),
			);
			const settings = yield* settingsOf(outcome, organizationId);
			logger.info({ organizationId, currency: settings.currency }, "Billable currency changed");
			return settings;
		}),
);
