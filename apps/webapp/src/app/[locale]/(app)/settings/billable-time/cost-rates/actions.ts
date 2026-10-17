"use server";

import { Effect } from "effect";
import type {
	CostRatePeriodView,
	SuggestedWage,
} from "@/lib/billable-time/cost-rate";
import {
	changeCostRate,
	employeeExists,
	getSuggestedWage,
	isEmployeeId,
	listCostRateHistory,
} from "@/lib/billable-time/cost-rates";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { createRateActions } from "../rate-actions";

const logger = createLogger("CostRateActions");

export interface CostRateHistory {
	currency: BillableCurrency;
	/** Newest first. */
	periods: CostRatePeriodView[];
	/** An hourly employee's wage in effect, offered (never copied) as a starting value. */
	suggestedWage: SuggestedWage | null;
}
export type CostRateChangeResult = {
	changed: boolean;
	periods: CostRatePeriodView[];
};

const employeeNotFound = () =>
	new NotFoundError({
		message: "The employee was not found",
		entityType: "employee",
	});

const rateActions = createRateActions({
	adminOnly: "Only owners and admins can see and change cost rates",
	queryPrefix: "billableTime.costRates",
	actions: { read: "readCostRates", set: "setCostRate", end: "endCostRate" },
	parseTarget: (input: unknown) =>
		isEmployeeId(input)
			? Effect.succeed(input)
			: Effect.fail(
					new ValidationError({
						message: "Choose an employee",
						field: "employeeId",
					}),
				),
	notFound: employeeNotFound,
	loadHistory: Effect.fnUntraced(
		function* (service, organizationId, employeeId, currency) {
			const exists = yield* service.query(
				"billableTime.costRates.employee",
				() => employeeExists(service.db, organizationId, employeeId),
			);
			if (!exists) return yield* Effect.fail(employeeNotFound());
			const [periods, suggestedWage] = yield* service.query(
				"billableTime.costRates.history",
				() =>
					Promise.all([
						listCostRateHistory(service.db, organizationId, employeeId),
						getSuggestedWage(service.db, organizationId, employeeId, currency),
					]),
			);
			return { currency, periods, suggestedWage };
		},
	),
	change: (database, { target: employeeId, ...input }) =>
		changeCostRate(database, { ...input, employeeId }),
	logChange: (organizationId, employeeId, changed) => {
		logger.info({ organizationId, employeeId, changed }, "Cost rate changed");
	},
});

/** One employee's cost rates and optional wage suggestion; owners and admins only. */
export async function getCostRateHistory(input: {
	employeeId: unknown;
}): Promise<ServerActionResult<CostRateHistory>> {
	return rateActions.read(input.employeeId);
}

/** Sets an employee's cost rate from a date, for any contract type. Never changes the wage. */
export async function setCostRate(input: {
	employeeId: unknown;
	effectiveFrom: string;
	rate: string;
}): Promise<ServerActionResult<CostRateChangeResult>> {
	return rateActions.set(input.employeeId, input);
}

/** Ends the cost rate from a date; cost is unknown until the next rate. */
export async function endCostRate(input: {
	employeeId: unknown;
	effectiveFrom: string;
}): Promise<ServerActionResult<CostRateChangeResult>> {
	return rateActions.end(input.employeeId, input);
}
