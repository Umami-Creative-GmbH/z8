"use server";

import { Effect } from "effect";
import {
	type BillableRateOutcome,
	type BillableRatePeriodView,
	type BillableRateRefusal,
	changeBillableRate,
	listBillableRateHistory,
	parseBillableRateTarget,
} from "@/lib/billable-time/billable-rates";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { activeOrganizationActor } from "../action-actor";
import { billableTimeOff } from "../module-guard";

const logger = createLogger("BillableRateActions");

export interface BillableRateHistory {
	currency: BillableCurrency;
	/** Newest first. */
	periods: BillableRatePeriodView[];
}

const ADMIN_ONLY = "Only owners and admins can see and change billable rates";

const targetOf = (input: unknown) => {
	const target = parseBillableRateTarget(input);
	return target
		? Effect.succeed(target)
		: Effect.fail(new ValidationError({ message: "Choose what the rate is for", field: "target" }));
};

function refusalError(reason: BillableRateRefusal) {
	switch (reason) {
		case "billable_time_off":
			return billableTimeOff();
		case "target_not_found":
			return new NotFoundError({
				message: "The employee, project or customer was not found",
				entityType: "billable_rate_target",
			});
		case "invalid_rate":
			return new ValidationError({
				message: "Enter a positive hourly rate with at most two decimals",
				field: "rate",
			});
		case "invalid_date":
			return new ValidationError({ message: "Enter a valid date", field: "effectiveFrom" });
	}
}

/**
 * Reads one rate series of the active organization: the billable currency and
 * every period, newest first. Owners and admins only.
 */
export async function getBillableRateHistory(input: {
	target: unknown;
}): Promise<ServerActionResult<BillableRateHistory>> {
	const effect = Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: ADMIN_ONLY,
			action: "readRates",
		});
		const target = yield* targetOf(input.target);
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.rates.settings", () =>
			getBillableTimeSettings(actor.organizationId, dbService.db),
		);
		if (!settings.enabled || settings.currency === null) {
			return yield* Effect.fail(refusalError("billable_time_off"));
		}
		const currency = settings.currency;
		const periods = yield* dbService.query("billableTime.rates.history", () =>
			listBillableRateHistory(dbService.db, actor.organizationId, target),
		);
		return { currency, periods };
	});

	return runServerActionSafe(effect);
}

function changeRate(
	name: string,
	input: { target: unknown; change: Parameters<typeof changeBillableRate>[1]["change"] },
) {
	return Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: ADMIN_ONLY,
			action: name,
		});
		const target = yield* targetOf(input.target);
		const dbService = yield* DatabaseService;
		const outcome: BillableRateOutcome = yield* dbService.query(`billableTime.rates.${name}`, () =>
			changeBillableRate(dbService.db, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				target,
				change: input.change,
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
		logger.info(
			{ organizationId: actor.organizationId, level: target.level, changed: outcome.changed },
			"Billable rate changed",
		);
		return { changed: outcome.changed, periods: outcome.periods };
	});
}

/**
 * Sets a billable rate from a date (backdating allowed) for one rate level and
 * target of the active organization. Owners and admins only.
 */
export async function setBillableRate(input: {
	target: unknown;
	effectiveFrom: string;
	rate: string;
}): Promise<ServerActionResult<{ changed: boolean; periods: BillableRatePeriodView[] }>> {
	return runServerActionSafe(
		changeRate("set", {
			target: input.target,
			change: {
				kind: "set",
				effectiveFrom: String(input.effectiveFrom),
				rate: String(input.rate),
			},
		}),
	);
}

/**
 * Ends the billable rate in effect at a date: from then on, the next less
 * specific rate level applies. Owners and admins only.
 */
export async function endBillableRate(input: {
	target: unknown;
	effectiveFrom: string;
}): Promise<ServerActionResult<{ changed: boolean; periods: BillableRatePeriodView[] }>> {
	return runServerActionSafe(
		changeRate("end", {
			target: input.target,
			change: { kind: "end", effectiveFrom: String(input.effectiveFrom) },
		}),
	);
}
