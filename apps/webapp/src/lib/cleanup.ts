/**
 * Cleanup Jobs - Worker entry point
 *
 * Various cleanup tasks for background workers.
 */

import { cleanupExpiredExports } from "@/lib/export/export-service";
import { deleteOldAuditLogs } from "@/lib/audit/cleanup";
import { createLogger } from "@/lib/logger";
import { deleteOldNotifications } from "@/lib/notifications/notification-service";
import type { CleanupJobData } from "@/lib/queue";

const logger = createLogger("Cleanup");

/**
 * Run cleanup job from worker queue
 */
export async function runCleanup(data: CleanupJobData): Promise<{
	deletedCount: number;
}> {
	logger.info({ task: data.task }, "Starting cleanup");

	let deletedCount = 0;

	switch (data.task) {
		case "expired_exports":
			deletedCount = await cleanupExpiredExports();
			logger.info({ count: deletedCount }, "Cleaned up expired exports");
			break;

		case "old_notifications":
			deletedCount = await deleteOldNotifications(90);
			logger.info({ count: deletedCount }, "Cleaned up old notifications");
			break;

		case "old_audit_logs":
			deletedCount = await deleteOldAuditLogs(365);
			logger.info({ count: deletedCount }, "Cleaned up old audit logs");
			break;

		default:
			logger.warn({ task: data.task }, "Unknown cleanup task");
	}

	logger.info({ task: data.task, deletedCount }, "Cleanup completed");
	return { deletedCount };
}
