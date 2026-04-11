import { and, eq, gte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { complianceException, workPolicyViolation } from "@/db/schema";
import type { ComplianceSectionResult } from "../types";

const WORKFORCE_COMPLIANCE_LOOKBACK_DAYS = 7;

export interface WorkforceComplianceSnapshot {
	restPeriodViolations: number;
	generalPolicyViolations: number;
	overtimeViolations: number;
	pendingExceptions: number;
	latestViolationAt: string | null;
}

export function deriveWorkforceComplianceSection(
	snapshot: WorkforceComplianceSnapshot,
): ComplianceSectionResult {
	const status =
		snapshot.restPeriodViolations > 0 || snapshot.generalPolicyViolations > 0
			? "critical"
			: snapshot.overtimeViolations > 0 || snapshot.pendingExceptions > 0
				? "warning"
				: "healthy";

	return {
		card: {
			key: "workforceCompliance",
			status,
			headline:
				status === "critical"
					? "Workforce policy violations need review"
					: status === "warning"
						? "Workforce compliance is drifting"
						: "No recent workforce policy issues were detected",
			facts: [
				`Rest-period violations: ${snapshot.restPeriodViolations}`,
				`Other policy violations: ${snapshot.generalPolicyViolations}`,
				`Overtime violations: ${snapshot.overtimeViolations}`,
				`Pending exceptions: ${snapshot.pendingExceptions}`,
			],
			updatedAt: snapshot.latestViolationAt ?? DateTime.utc().toISO(),
			primaryLink: { label: "Open Compliance Settings", href: "/settings/compliance" },
		},
		recentCriticalEvents:
			status === "healthy"
				? []
				: [
						{
							id: "workforce-violations",
							sectionKey: "workforceCompliance",
							severity: status === "critical" ? "critical" : "warning",
							title: "Recent workforce policy findings",
							description: `Rest: ${snapshot.restPeriodViolations}, Other policy: ${snapshot.generalPolicyViolations}, Overtime: ${snapshot.overtimeViolations}`,
							occurredAt: snapshot.latestViolationAt ?? DateTime.utc().toISO()!,
							primaryLink: {
								label: "Inspect compliance",
								href: "/settings/compliance",
							},
						},
					],
	};
}

export async function getWorkforceComplianceSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const sevenDaysAgo = DateTime.utc()
		.minus({ days: WORKFORCE_COMPLIANCE_LOOKBACK_DAYS })
		.toJSDate();

	const [violationRows, pendingExceptionRows] = await Promise.all([
		db
			.select({
				violationType: workPolicyViolation.violationType,
				count: sql<number>`count(*)::int`,
				latestViolationAt: sql<Date | null>`max(${workPolicyViolation.violationDate})`,
			})
			.from(workPolicyViolation)
			.where(
				and(
					eq(workPolicyViolation.organizationId, organizationId),
					gte(workPolicyViolation.violationDate, sevenDaysAgo),
				),
			)
			.groupBy(workPolicyViolation.violationType),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(complianceException)
			.where(
				and(
					eq(complianceException.organizationId, organizationId),
					gte(complianceException.createdAt, sevenDaysAgo),
					eq(complianceException.status, "pending"),
				),
			),
	]);

	const snapshot: WorkforceComplianceSnapshot = {
		restPeriodViolations:
			violationRows.find((row) => row.violationType === "rest_period")?.count ?? 0,
		generalPolicyViolations: violationRows
			.filter((row) => {
				const violationType = String(row.violationType);
				return violationType !== "rest_period" && !violationType.startsWith("overtime_");
			})
			.reduce((total, row) => total + row.count, 0),
		overtimeViolations: violationRows
			.filter((row) => String(row.violationType).startsWith("overtime_"))
			.reduce((total, row) => total + row.count, 0),
		pendingExceptions: pendingExceptionRows[0]?.count ?? 0,
		latestViolationAt:
			violationRows
				.map((row) => row.latestViolationAt)
				.filter((value): value is Date => value instanceof Date)
				.sort((left, right) => right.getTime() - left.getTime())[0]
				?.toISOString() ?? null,
	};

	return deriveWorkforceComplianceSection(snapshot);
}
