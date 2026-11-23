import { COMPLIANCE_EXCEPTION_INBOX_PATH } from "@/lib/approvals/inbox/compliance-exception-inbox-path";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceException, workPolicyViolation } from "@/db/schema";
import { awaitingComplianceExceptionDecision } from "@/lib/compliance/pending-compliance-exception";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
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
	latestPendingExceptionAt: string | null;
}

export function deriveWorkforceComplianceSection(
	snapshot: WorkforceComplianceSnapshot,
): ComplianceSectionResult {
	const hasViolations =
		snapshot.restPeriodViolations > 0 ||
		snapshot.generalPolicyViolations > 0 ||
		snapshot.overtimeViolations > 0;
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
			updatedAt: snapshot.latestViolationAt ?? systemClock.nowInstant().toString(),
			primaryLink: {
				label: text("compliance.commandCenter.links.reviewComplianceExceptions"),
				href: COMPLIANCE_EXCEPTION_INBOX_PATH,
			},
		},
		recentCriticalEvents: [
			...(hasViolations
				? [
						{
							id: "workforce-violations",
							sectionKey: "workforceCompliance" as const,
							severity: status === "critical" ? ("critical" as const) : ("warning" as const),
							title: text("compliance.commandCenter.events.workforceFindings.title"),
							description: text("compliance.commandCenter.events.workforceFindings.description", {
								restPeriodViolations: snapshot.restPeriodViolations,
								generalPolicyViolations: snapshot.generalPolicyViolations,
								overtimeViolations: snapshot.overtimeViolations,
							}),
							occurredAt: snapshot.latestViolationAt ?? systemClock.nowInstant().toString(),
							// Violations are reviewed and acknowledged in the work-policy compliance view (#1977).
							primaryLink: {
								label: text("compliance.commandCenter.links.reviewPolicyViolations"),
								href: "/settings/work-policies?tab=work&view=compliance",
							},
						},
					]
				: []),
			...(snapshot.pendingExceptions > 0
				? [
						{
							id: "workforce-pending-exceptions",
							sectionKey: "workforceCompliance" as const,
							severity: "warning" as const,
							title: text("compliance.commandCenter.events.pendingExceptions.title"),
							description: text("compliance.commandCenter.events.pendingExceptions.description", {
								count: snapshot.pendingExceptions,
							}),
							occurredAt: snapshot.latestPendingExceptionAt ?? systemClock.nowInstant().toString(),
							primaryLink: {
								label: text("compliance.commandCenter.links.reviewComplianceExceptions"),
								href: COMPLIANCE_EXCEPTION_INBOX_PATH,
							},
						},
					]
				: []),
		],
	};
}

export async function getWorkforceComplianceSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const now = systemClock.nowInstant();
	const sevenDaysAgo = dateFromInstant(
		now
			.toZonedDateTimeISO("UTC")
			.subtract({ days: WORKFORCE_COMPLIANCE_LOOKBACK_DAYS })
			.toInstant(),
	);

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
			.select({
				count: sql<number>`count(*)::int`,
				latestPendingExceptionAt: sql<Date | null>`max(${complianceException.createdAt})`,
			})
			.from(complianceException)
			.where(
				and(
					eq(complianceException.organizationId, organizationId),
					gte(complianceException.createdAt, sevenDaysAgo),
					// A lapsed exception is expired, as in the Approval inbox this links to (#1977).
					awaitingComplianceExceptionDecision(now),
				),
			),
	]);
	const latestPendingExceptionAt = pendingExceptionRows[0]?.latestPendingExceptionAt;
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
		latestPendingExceptionAt:
			latestPendingExceptionAt == null ? null : new Date(latestPendingExceptionAt).toISOString(),
	};

	return deriveWorkforceComplianceSection(snapshot);
}
