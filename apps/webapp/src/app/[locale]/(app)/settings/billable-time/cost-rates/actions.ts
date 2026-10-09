"use server";

import { Effect } from "effect";
import type { CostRatePeriodView, SuggestedWage } from "@/lib/billable-time/cost-rate";
import {
	type CostRateChange,
	type CostRateOutcome,
	type CostRateRefusal,
	changeCostRate,
	employeeExists,
	getSuggestedWage,
	isEmployeeId,
	listCostRateHistory,
} from "@/lib/billable-time/cost-rates";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { activeOrganizationActor } from "../action-actor";
import { billableTimeOff } from "../module-guard";

const logger = createLogger("CostRateActions");

export interface CostRateHistory {
	currency: BillableCurrency;
	/** Newest first. */
	periods: CostRatePeriodView[];
	/** An hourly employee's wage in effect, offered (never copied) as a starting value. */
	suggestedWage: SuggestedWage | null;
}

export type CostRateChangeResult = { changed: boolean; periods: CostRatePeriodView[] };

const ADMIN_ONLY = "Only owners and admins can see and change cost rates";

const employeeIdOf = (input: unknown) =>
	isEmployeeId(input)
		? Effect.succeed(input)
		: Effect.fail(new ValidationError({ message: "Choose an employee", field: "employeeId" }));

function refusalError(reason: CostRateRefusal) {
	switch (reason) {
		case "billable_time_off":
			return billableTimeOff();
		case "employee_not_found":
			return new NotFoundError({ message: "The employee was not found", entityType: "employee" });
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
 * Reads one employee's cost rates in the active organization: the billable
 * currency, every period (newest first) and, for an hourly employee, the wage
 * in effect as a suggestion. Owners and admins only.
 */
export async function getCostRateHistory(input: {
	employeeId: unknown;
}): Promise<ServerActionResult<CostRateHistory>> {
	const effect = Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: ADMIN_ONLY,
			action: "readCostRates",
		});
		const employeeId = yield* employeeIdOf(input.employeeId);
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.costRates.settings", () =>
			getBillableTimeSettings(actor.organizationId, dbService.db),
		);
		if (!settings.enabled || settings.currency === null) {
			return yield* Effect.fail(refusalError("billable_time_off"));
		}
		const currency = settings.currency;
		const exists = yield* dbService.query("billableTime.costRates.employee", () =>
			employeeExists(dbService.db, actor.organizationId, employeeId),
		);
		if (!exists) return yield* Effect.fail(refusalError("employee_not_found"));
		const [periods, suggestedWage] = yield* dbService.query("billableTime.costRates.history", () =>
			Promise.all([
				listCostRateHistory(dbService.db, actor.organizationId, employeeId),
				getSuggestedWage(dbService.db, actor.organizationId, employeeId, currency),
			]),
		);
		return { currency, periods, suggestedWage };
	});

	return runServerActionSafe(effect);
}

function changeRate(name: string, input: { employeeId: unknown; change: CostRateChange }) {
	return Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: ADMIN_ONLY,
			action: name,
		});
		const employeeId = yield* employeeIdOf(input.employeeId);
		const dbService = yield* DatabaseService;
		const outcome: CostRateOutcome = yield* dbService.query(`billableTime.costRates.${name}`, () =>
			changeCostRate(dbService.db, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				employeeId,
				change: input.change,
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
		logger.info(
			{ organizationId: actor.organizationId, employeeId, changed: outcome.changed },
			"Cost rate changed",
		);
		return { changed: outcome.changed, periods: outcome.periods };
	});
}

/**
 * Sets an employee's cost rate from a date (backdating allowed), for any
 * contract type, in the active organization. Owners and admins only.
 */
export async function setCostRate(input: {
	employeeId: unknown;
	effectiveFrom: string;
	rate: string;
}): Promise<ServerActionResult<CostRateChangeResult>> {
	return runServerActionSafe(
		changeRate("setCostRate", {
			employeeId: input.employeeId,
			change: { kind: "set", effectiveFrom: String(input.effectiveFrom), rate: String(input.rate) },
		}),
	);
}

/**
 * Ends the cost rate in effect at a date: from then on, the employee's cost is
 * unknown until the next cost rate. Owners and admins only.
 */
export async function endCostRate(input: {
	employeeId: unknown;
	effectiveFrom: string;
}): Promise<ServerActionResult<CostRateChangeResult>> {
	return runServerActionSafe(
		changeRate("endCostRate", {
			employeeId: input.employeeId,
			change: { kind: "end", effectiveFrom: String(input.effectiveFrom) },
		}),
	);
}
