import { type Clock, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	AutoClockOutScanLeaseNotOwnedError,
	type AutoClockOutScanState,
	createAutoClockOutScanState,
} from "@/lib/time-tracking/automatic-clock-out/scan-state";
import type {
	AutoClockOutCandidate,
	AutoClockOutDeliveryResult,
	AutoClockOutMaintenanceResult,
	AutoClockOutOutcome,
} from "@/lib/time-tracking/automatic-clock-out/types";

const logger = createLogger("AutomaticClockOutMaintenance");
const refusalReasons = new Set([
	"collision",
	"append_review_required",
	"frozen_not_accepted",
	"legacy_not_accepted",
	"target_unknown",
	"target_not_active",
	"not_clocked_in",
	"invalid_interval",
	"billing_required",
	"admission_window",
	"project_not_allowed",
	"work_category_not_allowed",
	"access_denied",
	"invalid_command",
]);

export async function runAutoClockOutMaintenanceWith(deps: {
	clock: Clock;
	scanState: AutoClockOutScanState;
	listCandidates(input: {
		now: Instant;
		after: AutoClockOutCandidate | null;
		limit: number;
	}): Promise<AutoClockOutCandidate[]>;
	close(candidate: AutoClockOutCandidate): Promise<AutoClockOutOutcome>;
	deliverTasks(): Promise<AutoClockOutDeliveryResult>;
}): Promise<AutoClockOutMaintenanceResult> {
	const result: AutoClockOutMaintenanceResult = {
		attempted: 0,
		closed: 0,
		skipped: 0,
		deferred: 0,
		failed: 0,
		tasks: { claimed: 0, completed: 0, deferred: 0, failed: 0 },
		errors: [],
	};
	let discoveryFailed = false;
	try {
		const claimedAt = deps.clock.nowInstant();
		const claim = await deps.scanState.claim(claimedAt);
		if (claim) {
			let after = claim.after;
			let leaseUntil = claimedAt.add({ minutes: 5 });
			try {
				while (result.attempted < 1000) {
					const page = await deps.listCandidates({
						now: deps.clock.nowInstant(),
						after,
						limit: 100,
					});
					for (const candidate of page) {
						if (deps.clock.nowInstant().epochNanoseconds >= leaseUntil.epochNanoseconds)
							throw new AutoClockOutScanLeaseNotOwnedError();
						result.attempted++;
						try {
							const outcome = await deps.close(candidate);
							if (outcome.status === "replayed") result.skipped++;
							else result[outcome.status]++;
							if (outcome.status === "deferred") {
								const reason = refusalReasons.has(outcome.reason)
									? outcome.reason
									: "automatic_clock_out_refused";
								const scope = {
									organizationId: candidate.organizationId,
									workPeriodId: candidate.workPeriodId,
									error: reason,
								};
								result.errors.push(scope);
								logger.warn(scope, "Automatic clock-out refused; a later scan will retry");
							}
						} catch {
							result.failed++;
							const scope = {
								organizationId: candidate.organizationId,
								workPeriodId: candidate.workPeriodId,
								error: "automatic_clock_out_failed",
							};
							result.errors.push(scope);
							logger.error(scope, "Automatic clock-out candidate failed");
						}
						after = candidate;
					}
					if (page.length > 0 && after) {
						const now = deps.clock.nowInstant();
						await deps.scanState.advance({ token: claim.token, after, now });
						leaseUntil = now.add({ minutes: 5 });
					}
					if (page.length < 100) {
						after = null;
						break;
					}
				}
			} finally {
				await deps.scanState.release({
					token: claim.token,
					after,
					now: deps.clock.nowInstant(),
				});
			}
		}
	} catch (error) {
		if (error instanceof AutoClockOutScanLeaseNotOwnedError)
			logger.warn({ reason: "lease_not_owned" }, "Automatic clock-out discovery stopped");
		else {
			discoveryFailed = true;
			logger.error({ reason: "discovery_failed" }, "Automatic clock-out discovery failed");
		}
	}
	// Delivery has its own durable claims and remains available while discovery is held or broken.
	try {
		result.tasks = await deps.deliverTasks();
	} catch {
		logger.error({ reason: "task_recovery_failed" }, "Automatic clock-out task recovery failed");
		throw new Error("Automatic clock-out task recovery failed");
	}
	logger.info(result, "Automatic clock-out maintenance completed");
	if (discoveryFailed) throw new Error("Automatic clock-out discovery failed");
	return result;
}

export async function runAutoClockOutMaintenance(): Promise<AutoClockOutMaintenanceResult> {
	const [
		{ db },
		{ createAutoClockOutCommands },
		{ listDueAutoClockOutCandidates },
		{ runAutoClockOutDelivery },
	] = await Promise.all([
		import("@/db"),
		import("@/lib/time-tracking/automatic-clock-out/commands"),
		import("@/lib/time-tracking/automatic-clock-out/discovery"),
		import("@/lib/time-tracking/automatic-clock-out/delivery"),
	]);
	return runAutoClockOutMaintenanceWith({
		clock: systemClock,
		scanState: createAutoClockOutScanState(db),
		listCandidates: (input) => listDueAutoClockOutCandidates(input, db),
		close: createAutoClockOutCommands({ database: db, clock: systemClock }).close,
		deliverTasks: () => runAutoClockOutDelivery({ database: db, clock: systemClock, limit: 100 }),
	});
}
