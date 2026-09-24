import type { DepartureTaskKind } from "@/db/schema/employee-lifecycle";
import type { Instant } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { DepartureTaskClaim, DepartureTaskOutbox } from "./outbox";

const logger = createLogger("EmployeeDepartureDelivery");

export type DepartureTaskHandler = (claim: DepartureTaskClaim) => Promise<void>;

/** Kinds whose payload carries private data that is cleared once delivered. */
const PRIVATE_PAYLOAD_KINDS = new Set<DepartureTaskKind>(["session_revocation"]);

export type DepartureTaskDeliveryResult = {
	claimed: number;
	completed: number;
	deferred: number;
	failed: number;
};

/**
 * Delivers one batch of claimed departure tasks through a closed set of
 * handlers. A task kind without a handler fails terminally and stays visible;
 * it is never acknowledged silently. Handler failures retry with backoff. A
 * lost lease (another worker reclaimed the task) is logged, not overwritten.
 */
export async function runDepartureTaskDelivery(input: {
	outbox: DepartureTaskOutbox;
	handlers: Partial<Record<DepartureTaskKind, DepartureTaskHandler>>;
	now: Instant;
}): Promise<DepartureTaskDeliveryResult> {
	const claims = await input.outbox.claimDue(input.now);
	const result: DepartureTaskDeliveryResult = {
		claimed: claims.length,
		completed: 0,
		deferred: 0,
		failed: 0,
	};

	for (const claim of claims) {
		const handler = input.handlers[claim.kind];
		try {
			if (!handler) {
				await input.outbox.defer(claim, input.now, new Error("unsupported_departure_task_kind"), {
					terminal: true,
				});
				result.failed += 1;
				continue;
			}
			try {
				await handler(claim);
			} catch (error) {
				const outcome = await input.outbox.defer(claim, input.now, error, { terminal: false });
				result[outcome === "failed" ? "failed" : "deferred"] += 1;
				continue;
			}
			await input.outbox.complete(claim, input.now, {
				clearPayload: PRIVATE_PAYLOAD_KINDS.has(claim.kind),
			});
			result.completed += 1;
		} catch (error) {
			logger.warn(
				{
					taskId: claim.id,
					organizationId: claim.organizationId,
					kind: claim.kind,
					errorType: error instanceof Error ? error.name : "UnknownError",
				},
				"Departure task outcome could not be persisted",
			);
		}
	}
	return result;
}
