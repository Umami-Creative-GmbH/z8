/**
 * Compliance Radar Detection Job
 *
 * Nightly job that detects compliance violations for all organizations.
 * Creates findings for violations and sends notifications.
 */

import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { complianceConfig, employee } from "@/db/schema";
import { organization } from "@/db/auth-schema";
import { eq, and, inArray } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import {
	ComplianceDetectionService,
	ComplianceDetectionServiceLive,
} from "@/lib/effect/services/compliance-detection.service";
import {
	ComplianceFindingsService,
	ComplianceFindingsServiceLive,
} from "@/lib/effect/services/compliance-findings.service";
import { onComplianceFindingDetected } from "@/lib/notifications/compliance-radar-triggers";

const logger = createLogger("ComplianceRadarProcessor");

// ============================================
// TYPES
// ============================================

export interface ComplianceRadarResult {
	success: boolean;
	startedAt: Date;
	completedAt: Date;
	organizationsProcessed: number;
	findingsCreated: number;
	notificationsSent: number;
	errors: string[];
	details: Array<{
		organizationId: string;
		organizationName: string;
		findingsDetected: number;
		findingsCreated: number;
		error?: string;
	}>;
}

// ============================================
// MAIN PROCESSOR
// ============================================

export async function runComplianceRadarDetection(): Promise<ComplianceRadarResult> {
	const startedAt = new Date();
	const result: ComplianceRadarResult = {
		success: true,
		startedAt,
		completedAt: startedAt,
		organizationsProcessed: 0,
		findingsCreated: 0,
		notificationsSent: 0,
		errors: [],
		details: [],
	};

	logger.info("Starting compliance radar detection job");

	try {
		// Get all organizations with active compliance configs
		const configs = await db.query.complianceConfig.findMany({
			columns: { organizationId: true },
		});

		// Also get orgs without explicit config (will use defaults)
		const orgsWithConfig = new Set(configs.map((c) => c.organizationId));

		const allOrgs = await db.query.organization.findMany({
			columns: { id: true, name: true },
		});

		logger.info(
			{
				totalOrgs: allOrgs.length,
				orgsWithConfig: orgsWithConfig.size,
			},
			"Found organizations to process",
		);

		// Detection date range: yesterday (full day)
		const yesterday = DateTime.now().minus({ days: 1 });
		const dateRange = {
			start: yesterday.startOf("day"),
			end: yesterday.endOf("day"),
		};

		logger.info(
			{
				startDate: dateRange.start.toISO(),
				endDate: dateRange.end.toISO(),
			},
			"Detection date range",
		);

		// Process each organization
		for (const org of allOrgs) {
			result.organizationsProcessed++;

			const orgDetail: (typeof result.details)[0] = {
				organizationId: org.id,
				organizationName: org.name,
				findingsDetected: 0,
				findingsCreated: 0,
			};

			try {
				// Run detection
				const detectionProgram = Effect.gen(function* (_) {
					const detectionService = yield* _(ComplianceDetectionService);
					return yield* _(
						detectionService.detectFindings({
							organizationId: org.id,
							dateRange,
						}),
					);
				}).pipe(Effect.provide(ComplianceDetectionServiceLive));

				const detectionResult = await Effect.runPromise(detectionProgram);
				orgDetail.findingsDetected = detectionResult.findings.length;

				if (detectionResult.findings.length === 0) {
					logger.debug({ organizationId: org.id }, "No findings detected");
					result.details.push(orgDetail);
					continue;
				}

				// Deduplicate and create findings
				const findingsProgram = Effect.gen(function* (_) {
					const findingsService = yield* _(ComplianceFindingsService);
					const createdIds: string[] = [];

					for (const finding of detectionResult.findings) {
						// Check if finding already exists
						const exists = yield* _(
							findingsService.findingExists({
								organizationId: org.id,
								employeeId: finding.employeeId,
								type: finding.type,
								occurrenceDate: finding.occurrenceDate,
							}),
						);

						if (exists) {
							logger.debug(
								{
									organizationId: org.id,
									employeeId: finding.employeeId,
									type: finding.type,
								},
								"Finding already exists, skipping",
							);
							continue;
						}

						// Create the finding
						const id = yield* _(findingsService.createFinding(finding, "system"));
						createdIds.push(id);
					}

					return createdIds;
				}).pipe(Effect.provide(ComplianceFindingsServiceLive));

				const createdIds = await Effect.runPromise(findingsProgram);
				orgDetail.findingsCreated = createdIds.length;
				result.findingsCreated += createdIds.length;

				// Send notifications for warning/critical findings
				const config = await db.query.complianceConfig.findFirst({
					where: eq(complianceConfig.organizationId, org.id),
				});

				const notifySeverity = config?.notifyOnSeverity ?? "warning";
				const shouldNotify = config?.notifyManagers !== false;

				if (shouldNotify && createdIds.length > 0) {
					const findingsToNotify = detectionResult.findings.filter((f) => {
						if (notifySeverity === "critical") {
							return f.severity === "critical";
						}
						if (notifySeverity === "warning") {
							return f.severity === "warning" || f.severity === "critical";
						}
						return true; // info and above
					});

					for (const finding of findingsToNotify) {
						try {
							// Get employee details for notification
							const emp = await db.query.employee.findFirst({
								where: eq(employee.id, finding.employeeId),
								columns: { firstName: true, lastName: true, managerId: true },
								with: {
									manager: {
										columns: { userId: true },
									},
								},
							});

							if (emp) {
								await onComplianceFindingDetected({
									findingId: createdIds[0], // Would need proper mapping
									organizationId: org.id,
									employeeId: finding.employeeId,
									employeeName: `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim(),
									type: finding.type,
									severity: finding.severity,
									managerUserId: emp.manager?.userId,
								});
								result.notificationsSent++;
							}
						} catch (notifError) {
							logger.error(
								{ error: notifError, finding },
								"Failed to send notification for finding",
							);
						}
					}
				}

				logger.info(
					{
						organizationId: org.id,
						detected: orgDetail.findingsDetected,
						created: orgDetail.findingsCreated,
					},
					"Organization processed",
				);
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : String(error);
				orgDetail.error = errorMsg;
				result.errors.push(`Org ${org.id}: ${errorMsg}`);
				result.success = false;

				logger.error(
					{ error, organizationId: org.id },
					"Failed to process organization",
				);
			}

			result.details.push(orgDetail);
		}
	} catch (error) {
		logger.error({ error }, "Compliance radar detection job failed");
		result.success = false;
		result.errors.push(
			`Job failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	result.completedAt = new Date();

	const durationMs = result.completedAt.getTime() - result.startedAt.getTime();

	logger.info(
		{
			success: result.success,
			durationMs,
			organizationsProcessed: result.organizationsProcessed,
			findingsCreated: result.findingsCreated,
			notificationsSent: result.notificationsSent,
			errorCount: result.errors.length,
		},
		"Compliance radar detection job completed",
	);

	return result;
}
