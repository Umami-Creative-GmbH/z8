import { COMPLIANCE_EXCEPTION_INBOX_PATH } from "@/lib/approvals/inbox/compliance-exception-inbox-path";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceException, workPolicyViolation } from "@/db/schema";
import { awaitingComplianceExceptionDecision } from "@/lib/compliance/pending-compliance-exception";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	loadStatutoryReviewInbox,
	type StatutoryReviewDomainSummary,
} from "@/lib/statutory/review-inbox";
import type {
	ComplianceCriticalEvent,
	CompliancePrimaryLink,
	ComplianceSectionResult,
	ComplianceText,
} from "../types";

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
	/**
	 * Open statutory findings and acknowledgements per domain (#1994), or null when the statutory
	 * monitors could not be read at all. Omitted: no statutory data (older callers).
	 */
	statutory?: readonly StatutoryReviewDomainSummary[] | null;
	/** When the snapshot was taken: the card's date when no violation dates it. */
	evaluatedAt?: string;
}

/** Settings → Contracts → Reviews & Conflicts with one statutory domain preselected. */
export function statutoryReviewsHref(domain: StatutoryReviewDomainSummary["domain"]): string {
	return `/settings/contracts?tab=reviews&domain=${domain}`;
}

function openFindings(summary: StatutoryReviewDomainSummary): number {
	return summary.critical + summary.warning;
}

function statutoryParts(snapshot: WorkforceComplianceSnapshot) {
	const statutory = snapshot.statutory;
	if (statutory === undefined) {
		return { facts: [], links: [], critical: false, warning: false };
	}
	if (statutory === null) {
		return {
			facts: [text("compliance.commandCenter.facts.workforce.statutoryUnavailable")],
			links: [],
			critical: false,
			warning: true,
		};
	}
	const total = (pick: (summary: StatutoryReviewDomainSummary) => number) =>
		statutory.reduce((sum, summary) => sum + pick(summary), 0);
	const critical = total((summary) => summary.critical);
	const warning = total((summary) => summary.warning);
	const pending = total((summary) => summary.pendingAcknowledgements);
	const stale = total((summary) => summary.staleAcknowledgements);
	const unavailable = statutory.filter((summary) => summary.status === "unavailable").length;

	const facts: ComplianceText[] = [
		text("compliance.commandCenter.facts.workforce.statutoryFindings", { critical, warning }),
	];
	if (pending > 0 || stale > 0) {
		facts.push(
			text("compliance.commandCenter.facts.workforce.statutoryAcknowledgements", {
				pending,
				stale,
			}),
		);
	}
	if (unavailable > 0) {
		facts.push(text("compliance.commandCenter.facts.workforce.statutoryUnavailable"));
	}

	// Open findings are a standing backlog, not events: the card lists them per domain and they stay
	// out of "Recent critical events", where they would crowd out what actually just happened.
	const links: CompliancePrimaryLink[] = statutory
		.filter((summary) => openFindings(summary) > 0)
		.map((summary) => ({
			label: text(`compliance.commandCenter.links.statutoryDomain.${summary.domain}`, {
				count: openFindings(summary),
			}),
			href: statutoryReviewsHref(summary.domain),
		}));
	return {
		facts,
		links,
		critical: critical > 0,
		// Stale or pending acknowledgements need an org admin even without a warning finding.
		warning: warning > 0 || pending > 0 || stale > 0 || unavailable > 0,
	};
}

export function deriveWorkforceComplianceSection(
	snapshot: WorkforceComplianceSnapshot,
): ComplianceSectionResult {
	const occurredAt =
		snapshot.evaluatedAt ?? snapshot.latestViolationAt ?? systemClock.nowInstant().toString();
	const statutory = statutoryParts(snapshot);
	const hasViolations =
		snapshot.restPeriodViolations > 0 ||
		snapshot.generalPolicyViolations > 0 ||
		snapshot.overtimeViolations > 0;
	const status =
		snapshot.restPeriodViolations > 0 || snapshot.generalPolicyViolations > 0 || statutory.critical
			? "critical"
			: snapshot.overtimeViolations > 0 || snapshot.pendingExceptions > 0 || statutory.warning
				? "warning"
				: "healthy";
	const policyCritical = snapshot.restPeriodViolations > 0 || snapshot.generalPolicyViolations > 0;

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
				...statutory.facts,
			],
			updatedAt: snapshot.latestViolationAt ?? occurredAt,
			primaryLink: {
				label: text("compliance.commandCenter.links.reviewComplianceExceptions"),
				href: COMPLIANCE_EXCEPTION_INBOX_PATH,
			},
			...(statutory.links.length > 0 ? { links: statutory.links } : {}),
		},
		recentCriticalEvents: [
			...(hasViolations
				? [
						{
							id: "workforce-violations",
							sectionKey: "workforceCompliance",
							// Statutory findings never raise this event's severity: they stay out of it.
							severity: policyCritical ? "critical" : "warning",
							title: text("compliance.commandCenter.events.workforceFindings.title"),
							description: text("compliance.commandCenter.events.workforceFindings.description", {
								restPeriodViolations: snapshot.restPeriodViolations,
								generalPolicyViolations: snapshot.generalPolicyViolations,
								overtimeViolations: snapshot.overtimeViolations,
							}),
							occurredAt: snapshot.latestViolationAt ?? occurredAt,
							// Violations are reviewed and acknowledged in the work-policy compliance view (#1977).
							primaryLink: {
								label: text("compliance.commandCenter.links.reviewPolicyViolations"),
								href: "/settings/work-policies?tab=work&view=compliance",
							},
						} satisfies ComplianceCriticalEvent,
					]
				: []),
			...(snapshot.pendingExceptions > 0
				? [
						{
							id: "workforce-pending-exceptions",
							sectionKey: "workforceCompliance",
							severity: "warning",
							title: text("compliance.commandCenter.events.pendingExceptions.title"),
							description: text("compliance.commandCenter.events.pendingExceptions.description", {
								count: snapshot.pendingExceptions,
							}),
							occurredAt: snapshot.latestPendingExceptionAt ?? occurredAt,
							primaryLink: {
								label: text("compliance.commandCenter.links.reviewComplianceExceptions"),
								href: COMPLIANCE_EXCEPTION_INBOX_PATH,
							},
						} satisfies ComplianceCriticalEvent,
					]
				: []),
		],
	};
}

/**
 * The organization's statutory domain summaries, or null when the monitors cannot be read: the
 * section then reports them unavailable instead of failing as a whole.
 */
async function loadStatutorySummaries(
	organizationId: string,
	now: Instant,
): Promise<readonly StatutoryReviewDomainSummary[] | null> {
	try {
		// Counts only: the section shows no names, so none are read.
		return (await loadStatutoryReviewInbox(db, { organizationId, now, countsOnly: true })).domains;
	} catch (error) {
		console.error("[compliance-command-center] statutory monitors unavailable", error);
		return null;
	}
}

export async function getWorkforceComplianceSection(
	organizationId: string,
	options: { readonly now?: Instant } = {},
): Promise<ComplianceSectionResult> {
	const now = options.now ?? systemClock.nowInstant();
	const sevenDaysAgo = dateFromInstant(
		now
			.toZonedDateTimeISO("UTC")
			.subtract({ days: WORKFORCE_COMPLIANCE_LOOKBACK_DAYS })
			.toInstant(),
	);

	const [violationRows, pendingExceptionRows, statutory] = await Promise.all([
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
		loadStatutorySummaries(organizationId, now),
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
		statutory,
		evaluatedAt: now.toString(),
	};

	return deriveWorkforceComplianceSection(snapshot);
}
