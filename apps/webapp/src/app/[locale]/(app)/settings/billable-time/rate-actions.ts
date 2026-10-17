import "server-only";

import { Effect } from "effect";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { BillableRatePeriodView } from "@/lib/billable-time/rate-target";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import {
	type DatabaseError,
	type NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import {
	type DatabaseClient,
	DatabaseService,
} from "@/lib/effect/services/database.service";
import { activeOrganizationActor } from "./action-actor";
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

interface RateActionConfig<Target, History> {
	adminOnly: string;
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
	) => Promise<
		({ ok: true } & RateChangeResult) | { ok: false; reason: RateRefusal }
	>;
	logChange: (organizationId: string, target: Target, changed: boolean) => void;
}

/** Shared orchestration; adapters retain target validation and kind-specific readers/writers. */
export function createRateActions<Target, History>(
	config: RateActionConfig<Target, History>,
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
				return new ValidationError({
					message: "Enter a valid date",
					field: "effectiveFrom",
				});
		}
	};

	const changeRate = Effect.fnUntraced(function* (
		name: string,
		input: unknown,
		change: RateChange,
	) {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: config.adminOnly,
			action: name,
		});
		const target = yield* config.parseTarget(input);
		const service = yield* DatabaseService;
		const outcome = yield* service.query(`${config.queryPrefix}.${name}`, () =>
			config.change(service.db, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				target,
				change,
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
		config.logChange(actor.organizationId, target, outcome.changed);
		return { changed: outcome.changed, periods: outcome.periods };
	});

	return {
		read(input: unknown) {
			return runServerActionSafe(
				Effect.gen(function* () {
					const actor = yield* activeOrganizationActor({
						requiredRole: "admin",
						message: config.adminOnly,
						action: config.actions.read,
					});
					const target = yield* config.parseTarget(input);
					const service = yield* DatabaseService;
					const settings = yield* service.query(
						`${config.queryPrefix}.settings`,
						() => getBillableTimeSettings(actor.organizationId, service.db),
					);
					if (!settings.enabled || settings.currency === null)
						return yield* Effect.fail(billableTimeOff());
					return yield* config.loadHistory(
						service,
						actor.organizationId,
						target,
						settings.currency,
					);
				}),
			);
		},
		set(input: unknown, change: { effectiveFrom: string; rate: string }) {
			return runServerActionSafe(
				changeRate(config.actions.set, input, {
					kind: "set",
					effectiveFrom: String(change.effectiveFrom),
					rate: String(change.rate),
				}),
			);
		},
		end(input: unknown, change: { effectiveFrom: string }) {
			return runServerActionSafe(
				changeRate(config.actions.end, input, {
					kind: "end",
					effectiveFrom: String(change.effectiveFrom),
				}),
			);
		},
	};
}
