import {
	type CloseExpiredUncertainDurableDispatchesResult,
	closeExpiredUncertainDurableDispatches,
	type DurableDispatchDb,
} from "@/lib/chat-installations/durable-dispatch";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";

export interface DurableChatDispatchMaintenanceResult extends CloseExpiredUncertainDurableDispatchesResult {
	ranAt: string;
}

/**
 * Scheduled maintenance entry point for closing unresolved uncertain durable chat
 * notification dispatch attempts after 7 days with an explicit `closed_unknown` outcome.
 */
export async function runDurableChatDispatchMaintenance(deps?: {
	db?: DurableDispatchDb;
	clock?: Clock;
	organizationId?: string;
}): Promise<DurableChatDispatchMaintenanceResult> {
	const clock = deps?.clock ?? systemClock;
	const now = dateFromInstant(clock.nowInstant());
	const result = await closeExpiredUncertainDurableDispatches(now, {
		db: deps?.db,
		organizationId: deps?.organizationId,
	});
	return {
		...result,
		ranAt: now.toISOString(),
	};
}
