import {
	type CloseExpiredUncertainDurableDispatchesResult,
	closeExpiredUncertainDurableDispatches,
	type DurableDispatchDb,
} from "@/lib/chat-installations/durable-dispatch";
import {
	type ChatRecoveryDb,
	type ProcessChatInstallationCleanupResult,
	processChatInstallationCleanupJobs,
} from "@/lib/chat-installations/recovery-lifecycle";
import {
	type ChatSwitchDb,
	type RetireSettledChatInstallationsResult,
	retireSettledChatInstallations,
} from "@/lib/chat-installations/switch-lifecycle";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";

export interface DurableChatDispatchMaintenanceResult extends CloseExpiredUncertainDurableDispatchesResult {
	ranAt: string;
	retiredInstallations: RetireSettledChatInstallationsResult;
	cleanupJobs: ProcessChatInstallationCleanupResult;
}

/**
 * Scheduled maintenance entry point for:
 * 1) Closing unresolved uncertain durable chat notification dispatch attempts after 7 days
 *    with an explicit `closed_unknown` outcome (#2044).
 * 2) Automatically retiring `retiring` chat installations whose eligible approval cards and
 *    work have settled to 0 or whose 30-day retirement deadline has been reached (#2045).
 * 3) Running asynchronous retryable credential-revision and generation-fenced provider
 *    endpoint cleanup jobs (#2046).
 */
export async function runDurableChatDispatchMaintenance(deps?: {
	db?: DurableDispatchDb;
	clock?: Clock;
	organizationId?: string;
}): Promise<DurableChatDispatchMaintenanceResult> {
	const clock = deps?.clock ?? systemClock;
	const now = dateFromInstant(clock.nowInstant());
	const [result, retiredInstallations, cleanupJobs] = await Promise.all([
		closeExpiredUncertainDurableDispatches(now, {
			db: deps?.db,
			organizationId: deps?.organizationId,
		}),
		retireSettledChatInstallations(now, {
			db: deps?.db as ChatSwitchDb | undefined,
			organizationId: deps?.organizationId,
		}),
		processChatInstallationCleanupJobs(
			{
				now,
				organizationId: deps?.organizationId,
			},
			{
				db: deps?.db as ChatRecoveryDb | undefined,
			},
		),
	]);
	return {
		...result,
		retiredInstallations,
		cleanupJobs,
		ranAt: now.toISOString(),
	};
}
