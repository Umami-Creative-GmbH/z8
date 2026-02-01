/**
 * Audit Report Executor
 *
 * Handles execution of scheduled audit reports.
 * Creates audit log exports for compliance and monitoring purposes.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, auditLog } from "@/db";
import { createLogger } from "@/lib/logger";
import { uploadExport, getPresignedUrl } from "@/lib/storage/export-s3-client";
import type { IReportExecutor, ExecuteParams } from "./base-executor";
import type { ExecutionResult, AuditReportConfig, ReportConfig } from "../../domain/types";

const logger = createLogger("AuditReportExecutor");

/**
 * Audit Report Executor
 *
 * Exports audit logs for a date range, optionally filtered by event type.
 */
export class AuditReportExecutor implements IReportExecutor {
	readonly reportType = "audit_report";
	readonly displayName = "Audit Report";

	/**
	 * Execute an audit report export
	 */
	async execute(params: ExecuteParams): Promise<ExecutionResult> {
		const { organizationId, reportConfig, dateRange } = params;
		const config = reportConfig as AuditReportConfig;

		logger.info(
			{
				organizationId,
				dateRange: {
					start: dateRange.start.toISODate(),
					end: dateRange.end.toISODate(),
				},
				eventTypes: config.auditEventTypes,
			},
			"Executing audit report",
		);

		try {
			// Build query conditions
			const conditions = [
				eq(auditLog.organizationId, organizationId),
				gte(auditLog.timestamp, dateRange.start.toJSDate()),
				lte(auditLog.timestamp, dateRange.end.toJSDate()),
			];

			// Fetch audit logs
			const logs = await db.query.auditLog.findMany({
				where: and(...conditions),
				orderBy: (log, { desc }) => [desc(log.timestamp)],
			});

			// Filter by event types if specified
			const filteredLogs = config.auditEventTypes && config.auditEventTypes.length > 0
				? logs.filter((log) => config.auditEventTypes!.includes(log.action))
				: logs;

			logger.info({ count: filteredLogs.length }, "Audit logs fetched");

			// Generate CSV content
			const csvContent = this.generateCsv(filteredLogs, config.includeMetadata);

			// Generate S3 key
			const timestamp = dateRange.start.toFormat("yyyyMMdd");
			const s3Key = `audit-reports/${organizationId}/${timestamp}_audit_report.csv`;

			// Upload to S3
			await uploadExport(organizationId, s3Key, Buffer.from(csvContent, "utf-8"), "text/csv");

			// Generate presigned URL
			const s3Url = await getPresignedUrl(organizationId, s3Key, 604800); // 7 days

			return {
				success: true,
				underlyingJobType: "audit_report",
				s3Key,
				s3Url,
				fileSizeBytes: csvContent.length,
				recordCount: filteredLogs.length,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error: errorMessage, organizationId }, "Audit report execution failed");

			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Generate CSV content from audit logs
	 */
	private generateCsv(
		logs: Array<{
			id: string;
			action: string;
			entityType: string;
			entityId: string;
			performedBy: string;
			metadata: string | null;
			timestamp: Date;
		}>,
		includeMetadata?: boolean,
	): string {
		// CSV headers
		const headers = ["id", "timestamp", "action", "entity_type", "entity_id", "performed_by"];
		if (includeMetadata) {
			headers.push("metadata");
		}

		// Build rows
		const rows = logs.map((log) => {
			const row = [
				log.id,
				log.timestamp.toISOString(),
				log.action,
				log.entityType || "",
				log.entityId || "",
				log.performedBy || "",
			];
			if (includeMetadata) {
				row.push(log.metadata || "{}");
			}
			return row.map((cell) => this.escapeCsvCell(String(cell))).join(",");
		});

		return [headers.join(","), ...rows].join("\n");
	}

	/**
	 * Escape a CSV cell value to prevent CSV injection attacks
	 * Prefixes formula characters with single quote when opened in spreadsheets
	 */
	private escapeCsvCell(value: string): string {
		let escaped = String(value);
		// Prevent CSV injection by prefixing formula characters with single quote
		if (/^[=+\-@]/.test(escaped)) {
			escaped = `'${escaped}`;
		}
		return `"${escaped.replace(/"/g, '""')}"`;
	}

	/**
	 * Validate audit report configuration
	 */
	validateConfig(config: ReportConfig): { valid: boolean; errors?: string[] } {
		// Audit reports have minimal validation - all fields are optional
		return { valid: true };
	}
}
