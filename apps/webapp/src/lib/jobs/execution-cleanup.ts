import { cleanupOldExecutions } from "@/lib/cron/tracking";

const DAYS_TO_KEEP = 90;

export interface ExecutionCleanupResult {
	success: true;
	deletedCount: number;
	daysToKeep: typeof DAYS_TO_KEEP;
}

export async function runExecutionCleanup(): Promise<ExecutionCleanupResult> {
	const deletedCount = await cleanupOldExecutions(DAYS_TO_KEEP);

	return { success: true, deletedCount, daysToKeep: DAYS_TO_KEEP };
}
