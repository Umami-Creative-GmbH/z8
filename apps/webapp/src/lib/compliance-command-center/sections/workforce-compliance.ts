import { and, eq, gte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { complianceException, workPolicyViolation } from "@/db/schema";
import type { ComplianceSectionResult, ComplianceText } from "../types";

const WORKFORCE_COMPLIANCE_LOOKBACK_DAYS = 7;

function text(key: string, params?: Record<string, string | number>): ComplianceText {
	return params ? { key, params } : { key };
}

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
					? text("compliance.commandCenter.sections.workforceCompliance.headline.critical")
					: status === "warning"
						? text("compliance.commandCenter.sections.workforceCompliance.headline.warning")
						: text("compliance.commandCenter.sections.workforceCompliance.headline.healthy"),
			facts: [
				text("compliance.commandCenter.facts.workforce.restPeriodViolations", {
					count: snapshot.restPeriodViolations,
				}),
				text("compliance.commandCenter.facts.workforce.generalPolicyViolations", {
					count: snapshot.generalPolicyViolations,
				}),
				text("compliance.commandCenter.facts.workforce.overtimeViolations", {
					count: snapshot.overtimeViolations,
				}),
				text("compliance.commandCenter.facts.workforce.pendingExceptions", {
					count: snapshot.pendingExceptions,
				}),
			],
			updatedAt: snapshot.latestViolationAt ?? DateTime.utc().toISO(),
			primaryLink: {
				label: text("compliance.commandCenter.links.openComplianceSettings"),
				href: "/settings/compliance",
			},
		},
		recentCriticalEvents:
			status === "healthy"
				? []
				: [
						{
							id: "workforce-violations",
							sectionKey: "workforceCompliance",
							severity: status === "critical" ? "critical" : "warning",
							title: text("compliance.commandCenter.events.workforceFindings.title"),
							description: text("compliance.commandCenter.events.workforceFindings.description", {
								restPeriodViolations: snapshot.restPeriodViolations,
								generalPolicyViolations: snapshot.generalPolicyViolations,
								overtimeViolations: snapshot.overtimeViolations,
							}),
							occurredAt: snapshot.latestViolationAt ?? DateTime.utc().toISO()!,
							primaryLink: {
								label: text("compliance.commandCenter.links.inspectCompliance"),
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
	let latestViolationAtMs: number | null = null;
	for (const row of violationRows) {
		if (!(row.latestViolationAt instanceof Date)) {
			continue;
		}

		const timestamp = row.latestViolationAt.getTime();
		latestViolationAtMs =
			latestViolationAtMs === null ? timestamp : Math.max(latestViolationAtMs, timestamp);
	}

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
			latestViolationAtMs === null ? null : new Date(latestViolationAtMs).toISOString(),
	};

	return deriveWorkforceComplianceSection(snapshot);
}
