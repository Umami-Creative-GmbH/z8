/**
 * Production composition for the employee lifecycle, shared by the web app
 * and the BullMQ worker. Deliberately free of `server-only` (the worker runs
 * in plain Node) and of Next.js request APIs.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { type DepartureTaskKind, employeeDeparture } from "@/db/schema/employee-lifecycle";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { secondaryStorage } from "@/lib/redis";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { createDepartureClockOut } from "./clock-out";
import { createClockPostprocessHandler } from "./clock-postprocess";
import { createDepartureCommands } from "./commands";
import type { DepartureTaskHandler } from "./delivery";
import { createSessionRevocationHandler } from "./session-cleanup";
import type { DepartureIdentity } from "./types";

const DUE_BATCH_LIMIT = 100;

export function createProductionDepartureCommands() {
	return createDepartureCommands({
		db,
		clock: systemClock,
		clockOut: createDepartureClockOut(),
	});
}

/**
 * Global discovery of due departures for infrastructure only; every
 * execution reloads and re-validates its own organization-scoped state.
 * Ordered by cutoff then ID so owner outcomes are deterministic.
 */
export async function listDueDepartures(now: Instant): Promise<DepartureIdentity[]> {
	const rows = await db
		.select({
			organizationId: employeeDeparture.organizationId,
			employeeId: employeeDeparture.employeeId,
			employmentPeriodId: employeeDeparture.employmentPeriodId,
			departureId: employeeDeparture.id,
			revision: employeeDeparture.revision,
		})
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.status, "pending"),
				lte(employeeDeparture.cutoffAt, dateFromInstant(now)),
			),
		)
		.orderBy(asc(employeeDeparture.cutoffAt), asc(employeeDeparture.id))
		.limit(DUE_BATCH_LIMIT);
	return rows;
}

export type EmployeeDepartureJobScheduler = (input: {
	identity: DepartureIdentity;
	cutoff: Instant;
}) => Promise<void>;

/**
 * Handlers for durable departure follow-up work. Billing is added with the
 * shared seat counter; kinds without a handler fail visibly.
 */
export function createProductionDepartureTaskHandlers(options: {
	scheduleDepartureJob: EmployeeDepartureJobScheduler;
}): Partial<Record<DepartureTaskKind, DepartureTaskHandler>> {
	return {
		dispatch_departure: createDispatchDepartureHandler(options.scheduleDepartureJob),
		session_revocation: createSessionRevocationHandler((token) =>
			secondaryStorage.deleteOrThrow(token),
		),
		// The open clock_repair review is the durable record; nothing is safe to
		// retry automatically against that period.
		clock_repair: async () => {},
		clock_postprocess: createClockPostprocessHandler({
			enforceBreaks: (input) =>
				Effect.runPromise(
					Effect.gen(function* (_) {
						const breakService = yield* _(BreakEnforcementService);
						return yield* _(breakService.enforceBreaksAfterClockOut(input));
					}).pipe(
						Effect.provide(BreakEnforcementServiceLive),
						Effect.provide(WorkPolicyServiceLive),
						Effect.provide(DatabaseServiceLive),
					),
				),
			reconcileSurcharges: (input) =>
				Effect.runPromise(
					Effect.gen(function* (_) {
						const surchargeService = yield* _(SurchargeService);
						yield* _(
							surchargeService.reconcileWorkPeriods({
								organizationId: input.organizationId,
								employeeId: input.employeeId,
								surchargePeriodIds: input.affectedWorkPeriodIds,
								staleSurchargePeriodIds: [],
								surchargeSnapshot: input.snapshot,
							}),
						);
					}).pipe(Effect.provide(SurchargeServiceLive), Effect.provide(DatabaseServiceLive)),
				),
			markWorkBalanceDirty: (input) => markEmployeeWorkBalanceDirty(input),
		}),
	};
}

/**
 * Enqueues the delayed execution job for the exact revision the task was
 * created for. An obsolete revision needs no job; the job itself re-validates.
 */
function createDispatchDepartureHandler(
	scheduleDepartureJob: EmployeeDepartureJobScheduler,
): DepartureTaskHandler {
	return async (claim) => {
		const revision = claim.payload.revision;
		if (!claim.departureId || typeof revision !== "number") {
			throw new Error("invalid_dispatch_departure_payload");
		}
		const [departure] = await db
			.select({
				status: employeeDeparture.status,
				revision: employeeDeparture.revision,
				cutoffAt: employeeDeparture.cutoffAt,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, claim.organizationId),
					eq(employeeDeparture.id, claim.departureId),
				),
			);
		if (!departure || departure.status !== "pending" || departure.revision !== revision) return;
		await scheduleDepartureJob({
			identity: {
				organizationId: claim.organizationId,
				employeeId: claim.employeeId,
				employmentPeriodId: claim.employmentPeriodId,
				departureId: claim.departureId,
				revision,
			},
			cutoff: instantFromDate(departure.cutoffAt),
		});
	};
}
