import "server-only";

import { Effect } from "effect";
import { z } from "zod";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { BillableRatePeriodView } from "@/lib/billable-time/rate-target";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { type DatabaseError, type NotFoundError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { billableTimeOff } from "./module-guard";

type RateChange =
	| { kind: "set"; effectiveFrom: string; rate: string }
	| { kind: "end"; effectiveFrom: string };
type RateChangeResult = { changed: boolean; periods: BillableRatePeriodView[] };
type RateRefusal =
	| "billable_time_off"
	| "invalid_rate"
	| "invalid_date"
	| "target_not_found"
	| "employee_not_found";

interface RateActionConfig<TargetKey extends string, Target, History> {
	/** The input field naming what the rate is for, e.g. `target` or `employeeId`. */
	targetKey: TargetKey;
	/** Names the actions' spans, e.g. `billableTime.rates`. */
	queryPrefix: string;
	actions: { read: string; set: string; end: string };
	parseTarget: (input: unknown) => Effect.Effect<Target, ValidationError>;
	notFound: () => NotFoundError;
	loadHistory: (
		service: DatabaseService["Service"],
		organizationId: string,
		target: Target,
		currency: BillableCurrency,
	) => Effect.Effect<History, DatabaseError | NotFoundError>;
	change: (
		database: DatabaseClient,
		input: {
			organizationId: string;
			actorUserId: string;
			target: Target;
			change: RateChange;
		},
	) => Promise<({ ok: true } & RateChangeResult) | { ok: false; reason: RateRefusal }>;
	logChange: (organizationId: string, target: Target, changed: boolean) => void;
}

/**
 * The read, set and end actions of one kind of rate, for org admins of the
 * active organization. The target is read by `parseTarget`, so its refusal keeps
 * its wording; the kind keeps its readers and writers.
 */
export function createRateActions<TargetKey extends string, Target, History>(
	config: RateActionConfig<TargetKey, Target, History>,
) {
	const refusalError = (reason: RateRefusal) => {
		switch (reason) {
			case "billable_time_off":
				return billableTimeOff();
			case "target_not_found":
			case "employee_not_found":
				return config.notFound();
			case "invalid_rate":
				return new ValidationError({
					message: "Enter a positive hourly rate with at most two decimals",
					field: "rate",
				});
			case "invalid_date":
				return new ValidationError({ message: "Enter a valid date", field: "effectiveFrom" });
		}
	};

	// The target field's name differs per kind; the schemas are typed by hand for it.
	type TargetInput = Record<TargetKey, unknown>;
	const targetShape = { [config.targetKey]: z.unknown() };
	const dateSchema = z.string().max(32);
	const rateSchema = z.string().max(32);
	const readSchema = z.strictObject(targetShape) as unknown as z.ZodType<TargetInput>;
	const setSchema = z.strictObject({
		...targetShape,
		effectiveFrom: dateSchema,
		rate: rateSchema,
	}) as unknown as z.ZodType<TargetInput & { effectiveFrom: string; rate: string }>;
	const endSchema = z.strictObject({
		...targetShape,
		effectiveFrom: dateSchema,
	}) as unknown as z.ZodType<TargetInput & { effectiveFrom: string }>;

	const changeRate = (
		name: string,
		context: { actorUserId: string; organizationId: string; target: unknown },
		change: RateChange,
	) =>
		Effect.gen(function* () {
			const target = yield* config.parseTarget(context.target);
			const service = yield* DatabaseService;
			const outcome = yield* service.query(`${config.queryPrefix}.${name}`, () =>
				config.change(service.db, {
					organizationId: context.organizationId,
					actorUserId: context.actorUserId,
					target,
					change,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
			config.logChange(context.organizationId, target, outcome.changed);
			return { changed: outcome.changed, periods: outcome.periods } satisfies RateChangeResult;
		});

	return {
		read: organizationAction(
			{
				name: `${config.queryPrefix}.${config.actions.read}`,
				requires: "orgAdmin",
				schema: readSchema,
			},
			({ organizationId, input }) =>
				Effect.gen(function* () {
					const target = yield* config.parseTarget(input[config.targetKey]);
					const service = yield* DatabaseService;
					const settings = yield* service.query(`${config.queryPrefix}.settings`, () =>
						getBillableTimeSettings(organizationId, service.db),
					);
					if (!settings.enabled || settings.currency === null) {
						return yield* Effect.fail(billableTimeOff());
					}
					return yield* config.loadHistory(service, organizationId, target, settings.currency);
				}),
		),
		set: organizationAction(
			{
				name: `${config.queryPrefix}.${config.actions.set}`,
				requires: "orgAdmin",
				schema: setSchema,
			},
			({ actor, organizationId, input }) =>
				changeRate(
					config.actions.set,
					{ actorUserId: actor.userId, organizationId, target: input[config.targetKey] },
					{ kind: "set", effectiveFrom: input.effectiveFrom, rate: input.rate },
				),
		),
		end: organizationAction(
			{
				name: `${config.queryPrefix}.${config.actions.end}`,
				requires: "orgAdmin",
				schema: endSchema,
			},
			({ actor, organizationId, input }) =>
				changeRate(
					config.actions.end,
					{ actorUserId: actor.userId, organizationId, target: input[config.targetKey] },
					{ kind: "end", effectiveFrom: input.effectiveFrom },
				),
		),
	};
}
