import { sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { auditLog, db } from "@/db";
import { createLogger } from "@/lib/logger";
import { AUDIT_LOG_RETENTION_DAYS } from "./retention";

const logger = createLogger("AuditCleanup");

/**
 * Delete old audit logs (cleanup job)
 */
export async function deleteOldAuditLogs(
	olderThanDays: number = AUDIT_LOG_RETENTION_DAYS,
): Promise<number> {
	try {
		const cutoffDate = DateTime.utc().minus({ days: olderThanDays }).toJSDate();

		const result = await db
			.delete(auditLog)
			.where(sql`${auditLog.timestamp} < ${cutoffDate}`)
			.returning({ id: auditLog.id });

		const deletedCount = result.length;
		logger.info({ deletedCount, olderThanDays }, "Old audit logs cleaned up");

		return deletedCount;
	} catch (error) {
		logger.error({ error, olderThanDays }, "Failed to delete old audit logs");
		return 0;
	}
}
