import { db } from "@/db";
import { type Clock, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type DepartureTaskDeliveryResult,
	runDepartureTaskDelivery,
} from "@/lib/employee-lifecycle/delivery";
import { createDepartureTaskOutbox } from "@/lib/employee-lifecycle/outbox";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import {
	createProductionDepartureCommands,
	createProductionDepartureTaskHandlers,
	type EmployeeDepartureJobScheduler,
	listDueDepartures,
} from "@/lib/employee-lifecycle/runtime";
import type { DepartureIdentity, ExecuteDepartureResult } from "@/lib/employee-lifecycle/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("EmployeeDepartureJobs");

export type EmployeeDepartureMaintenanceResult = {
	released: boolean;
	departures: {
		processed: number;
		effective: number;
		blocked: number;
		obsolete: number;
		notDue: number;
		failed: number;
	};
	tasks: DepartureTaskDeliveryResult;
	errors: Array<{ organizationId: string; departureId: string; error: string }>;
};

const emptyTasks: DepartureTaskDeliveryResult = {
	claimed: 0,
	completed: 0,
	deferred: 0,
	failed: 0,
};

/**
 * Recovery scan behind the delayed per-departure jobs: materializes every due
 * departure (the jobs only make it prompt) and delivers durable follow-up
 * work. Each departure runs in its own transaction, so one failure never
 * blocks the others. Nothing runs while the release gate is closed.
 */
export async function runEmployeeDepartureMaintenanceWith(deps: {
	released: boolean;
	clock: Clock;
	listDueDepartures(now: Instant): Promise<DepartureIdentity[]>;
	executeDeparture(identity: DepartureIdentity): Promise<ExecuteDepartureResult>;
	deliverTasks(now: Instant): Promise<DepartureTaskDeliveryResult>;
}): Promise<EmployeeDepartureMaintenanceResult> {
	const result: EmployeeDepartureMaintenanceResult = {
		released: deps.released,
		departures: { processed: 0, effective: 0, blocked: 0, obsolete: 0, notDue: 0, failed: 0 },
		tasks: emptyTasks,
		errors: [],
	};
	if (!deps.released) return result;

	for (const identity of await deps.listDueDepartures(deps.clock.nowInstant())) {
		result.departures.processed += 1;
		try {
			const outcome = await deps.executeDeparture(identity);
			const key = outcome.status === "not_due" ? "notDue" : outcome.status;
			result.departures[key] += 1;
		} catch (error) {
			result.departures.failed += 1;
			result.errors.push({
				organizationId: identity.organizationId,
				departureId: identity.departureId,
				error: error instanceof Error ? error.message : String(error),
			});
			logger.error(
				{ error, organizationId: identity.organizationId, departureId: identity.departureId },
				"Due employee departure could not be materialized",
			);
		}
	}

	result.tasks = await deps.deliverTasks(deps.clock.nowInstant());
	return result;
}

/** Enqueues the prompt execution job; a repeated enqueue for a revision is harmless. */
export const scheduleEmployeeDepartureJob: EmployeeDepartureJobScheduler = async ({
	identity,
	cutoff,
}) => {
	const { addJob } = await import("@/lib/queue");
	await addJob(
		"execute-employee-departure",
		{ type: "employee-departure", ...identity },
		{
			jobId: `employee-departure-${identity.departureId}-${identity.revision}`,
			delay: Math.max(0, cutoff.epochMilliseconds - systemClock.nowInstant().epochMilliseconds),
			attempts: 5,
			backoff: { type: "exponential", delay: 1000 },
		},
	);
};

export async function runEmployeeDepartureMaintenance(): Promise<EmployeeDepartureMaintenanceResult> {
	const commands = createProductionDepartureCommands();
	const handlers = createProductionDepartureTaskHandlers({
		scheduleDepartureJob: scheduleEmployeeDepartureJob,
	});
	return runEmployeeDepartureMaintenanceWith({
		released: EMPLOYEE_OFFBOARDING_RELEASE_READY,
		clock: systemClock,
		listDueDepartures,
		executeDeparture: (identity) => commands.executeDeparture(identity),
		deliverTasks: (now) =>
			runDepartureTaskDelivery({ outbox: createDepartureTaskOutbox(db), handlers, now }),
	});
}

/**
 * Delayed execution of one departure revision. The job data never grants
 * authority: the transition reloads and re-validates everything, and an
 * edited, canceled or already effective revision is a no-op.
 */
export async function processEmployeeDepartureJob(
	identity: DepartureIdentity,
): Promise<ExecuteDepartureResult | { status: "not_released" }> {
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) return { status: "not_released" };
	return createProductionDepartureCommands().executeDeparture(identity);
}
