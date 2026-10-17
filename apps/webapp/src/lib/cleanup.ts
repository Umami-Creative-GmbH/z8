/**
 * Cleanup Jobs - Worker entry point
 *
 * Various cleanup tasks for background workers.
 */

import { deleteOldAuditLogs } from "@/lib/audit/cleanup";
import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/audit/retention";
import { cleanupExpiredExports } from "@/lib/export/export-service";
import { runClockingReminderOccasionRetention } from "@/lib/jobs/clocking-reminder-occasion-retention";
import { runKioskPinEventRetention } from "@/lib/jobs/kiosk-pin-event-retention";
import { runPositionRecordRetention } from "@/lib/jobs/position-record-retention";
import { runKeyRequestLogRetention } from "@/lib/jobs/public-api-request-log-retention";
import { runReportShareLinkViewRetention } from "@/lib/jobs/report-share-links";
import { createLogger } from "@/lib/logger";
import { deleteOldNotifications } from "@/lib/notifications/notification-service";
import type { CleanupJobData } from "@/lib/queue";
import { CLOCKING_REMINDER_OCCASION_RETENTION_DAYS } from "@/lib/time-tracking/clocking-reminders/occasion-retention";

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

		case "old_notifications": {
			deletedCount = await deleteOldNotifications(90);
			logger.info({ count: deletedCount }, "Cleaned up old notifications");
			// Sent-reminder claims are kept only while a reminder could still be due again (#919).
			const deletedOccasionCount = await runClockingReminderOccasionRetention(
				CLOCKING_REMINDER_OCCASION_RETENTION_DAYS,
			);
			logger.info(
				{ count: deletedOccasionCount },
				"Cleaned up clocking reminder occasions past retention",
			);
			deletedCount += deletedOccasionCount;
			// The key request log keeps a Public API request for 90 days (#763).
			const deletedKeyRequestCount = await runKeyRequestLogRetention();
			logger.info(
				{ count: deletedKeyRequestCount },
				"Cleaned up key request log entries past retention",
			);
			deletedCount += deletedKeyRequestCount;
			// Kiosk PIN events are kept only while they can affect a lockout check (#1288).
			const deletedKioskPinEventCount = await runKioskPinEventRetention();
			logger.info(
				{ count: deletedKioskPinEventCount },
				"Cleaned up kiosk PIN events past the lockout replay window",
			);
			deletedCount += deletedKioskPinEventCount;
			break;
		}

		case "old_audit_logs": {
			deletedCount = await deleteOldAuditLogs(AUDIT_LOG_RETENTION_DAYS);
			logger.info({ count: deletedCount }, "Cleaned up old audit logs");
			// Position consents, declines and access-log entries follow the audit-log lifetime (#766).
			const positionRecords = await runPositionRecordRetention(AUDIT_LOG_RETENTION_DAYS);
			logger.info(positionRecords, "Cleaned up position records past the audit-log lifetime");
			deletedCount +=
				positionRecords.accessLogEntries + positionRecords.consents + positionRecords.declines;
			// Report share link views follow the audit-log lifetime too (#806).
			const shareLinkViews = await runReportShareLinkViewRetention(AUDIT_LOG_RETENTION_DAYS);
			logger.info(
				{ count: shareLinkViews },
				"Cleaned up report share link views past the audit-log lifetime",
			);
			deletedCount += shareLinkViews;
			break;
		}

		default:
			logger.warn({ task: data.task }, "Unknown cleanup task");
	}

	logger.info({ task: data.task, deletedCount }, "Cleanup completed");
	return { deletedCount };
}
