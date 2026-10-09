"use server";

import { Effect } from "effect";
import {
	type BillableTimeOutcome,
	type BillableTimeRefusal,
	changeBillableCurrency,
	setBillableTimeEnabled,
} from "@/lib/billable-time/module-switch";
import type { AccountingProviderKind } from "@/lib/billable-time/accounting/provider";
import { accountingProviderName } from "@/lib/billable-time/accounting/views";
import type { BillableTimeSettings } from "@/lib/billable-time/settings";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { activeOrganizationActor } from "./action-actor";

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
			return new ValidationError({
				message: "Billable Time is switched off",
				field: "billableTimeEnabled",
			});
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
export async function switchBillableTime(input: {
	enabled: boolean;
	currency?: string | null;
}): Promise<ServerActionResult<BillableTimeSettings>> {
	const effect = Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "owner",
			message: "Only owners can change organization features",
			action: "switch",
		});
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.switch", () =>
			setBillableTimeEnabled(dbService.db, {
				organizationId: actor.organizationId,
				enabled: input.enabled === true,
				currency: input.currency ?? null,
				actorUserId: actor.userId,
			}),
		);
		const settings = yield* settingsOf(outcome, actor.organizationId);
		logger.info(
			{ organizationId: actor.organizationId, enabled: settings.enabled },
			`Billable Time ${settings.enabled ? "enabled" : "disabled"}`,
		);
		return settings;
	});

	return runServerActionSafe(effect);
}

/**
 * Changes the billable currency of the active organization. Org admins may do it
 * while the module is on and no billable rate or cost rate exists yet.
 */
export async function updateBillableCurrency(input: {
	currency: string;
}): Promise<ServerActionResult<BillableTimeSettings>> {
	const effect = Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: "Only owners and admins can change the billable currency",
			action: "updateCurrency",
		});
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.updateCurrency", () =>
			changeBillableCurrency(dbService.db, {
				organizationId: actor.organizationId,
				currency: input.currency,
				actorUserId: actor.userId,
			}),
		);
		const settings = yield* settingsOf(outcome, actor.organizationId);
		logger.info(
			{ organizationId: actor.organizationId, currency: settings.currency },
			"Billable currency changed",
		);
		return settings;
	});

	return runServerActionSafe(effect);
}
