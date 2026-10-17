"use server";

import { Effect } from "effect";
import {
	type BillableRatePeriodView,
	changeBillableRate,
	listBillableRateHistory,
	parseBillableRateTarget,
} from "@/lib/billable-time/billable-rates";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { createRateActions } from "../rate-actions";

const logger = createLogger("BillableRateActions");

export interface BillableRateHistory {
	currency: BillableCurrency;
	/** Newest first. */
	periods: BillableRatePeriodView[];
}

const rateActions = createRateActions({
	adminOnly: "Only owners and admins can see and change billable rates",
	queryPrefix: "billableTime.rates",
	actions: { read: "readRates", set: "set", end: "end" },
	parseTarget: (input: unknown) => {
		const target = parseBillableRateTarget(input);
		return target
			? Effect.succeed(target)
			: Effect.fail(
					new ValidationError({
						message: "Choose what the rate is for",
						field: "target",
					}),
				);
	},
	notFound: () =>
		new NotFoundError({
			message: "The employee, project or customer was not found",
			entityType: "billable_rate_target",
		}),
	loadHistory: (service, organizationId, target, currency) =>
		service.query(
			"billableTime.rates.history",
			async (): Promise<BillableRateHistory> => ({
				currency,
				periods: await listBillableRateHistory(
					service.db,
					organizationId,
					target,
				),
			}),
		),
	change: changeBillableRate,
	logChange: (organizationId, target, changed) => {
		logger.info(
			{ organizationId, level: target.level, changed },
			"Billable rate changed",
		);
	},
});

/** One rate level and target in the active organization; owners and admins only. */
export async function getBillableRateHistory(input: {
	target: unknown;
}): Promise<ServerActionResult<BillableRateHistory>> {
	return rateActions.read(input.target);
}

/** Sets a billable rate from a date, with backdating allowed. */
export async function setBillableRate(input: {
	target: unknown;
	effectiveFrom: string;
	rate: string;
}): Promise<
	ServerActionResult<{ changed: boolean; periods: BillableRatePeriodView[] }>
> {
	return rateActions.set(input.target, input);
}

/** Ends this level's rate from a date so the next less specific level applies. */
export async function endBillableRate(input: {
	target: unknown;
	effectiveFrom: string;
}): Promise<
	ServerActionResult<{ changed: boolean; periods: BillableRatePeriodView[] }>
> {
	return rateActions.end(input.target, input);
}
