/**
 * The unified statutory review inbox (#1994): every open statutory finding and every pending or
 * stale acknowledgement of an organization, across the five Milestone 2 monitors, for the
 * Compliance Command Center and Settings → Contracts → Reviews & Conflicts. Org admins only.
 *
 * It never judges anything itself. Each review domain reads its monitor's own review list, which
 * decides what needs an org admin's review (Minijob exceedance months, Berufsmäßigkeit prompts,
 * working-student weeks, on-call findings, JArbSchG sector exceptions), plus the monitor findings
 * no review list carries because they cannot be acknowledged (Minijob tiers and the rolling
 * 12-month cap, short-term day and month limits, JArbSchG hard limits, apprentice release
 * conflicts) within the planning horizon.
 *
 * A domain that fails to load is reported `unavailable` instead of failing the whole inbox.
 */
import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { StatutoryAcknowledgementKind } from "./acknowledgement-kinds";
import { apprenticeReleaseScheduleContributor } from "./apprenticeship/release-conflict-contributor";
import type { StatutoryFinding, StatutorySeverity } from "./finding";
import {
	addMonths,
	firstDayOf,
	MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
	MINIJOB_EXCEEDANCE_LEGAL_REFERENCE,
	MINIJOB_MONTHLY_FINDING,
} from "./minijob/minijob-months";
import { loadMinijobExceedanceReviews } from "./minijob/minijob-reviews";
import { minijobScheduleContributor } from "./minijob/minijob-schedule-contributor";
import { listOnCallReviewItems } from "./on-call/views";
import type { StatutoryScheduleContributor } from "./scheduling/contributor";
import { evaluateStatutoryFindings, toStatutoryComplianceFinding } from "./scheduling/evaluate";
import { shortTermScheduleContributor } from "./short-term/contributor";
import { listShortTermBerufsmaessigkeitReviews } from "./short-term/monitor";
import {
	type StatutoryReviewDomain,
	statutoryReviewDomainOf,
	statutoryReviewDomains,
} from "./review-domains";
import type { StatutoryDomain } from "./threshold-catalog";
import { listWorkingStudentReviewItems } from "./working-student/views";
import { jarbschgScheduleContributor } from "./youth/jarbschg-contributor";
import { listOpenYouthSectorExceptions } from "./youth/sector-exception-review";

type Reader = Pick<DatabaseClient, "select" | "query">;

export {
	statutoryReviewDomainOf,
	statutoryReviewDomains,
	type StatutoryReviewDomain,
} from "./review-domains";

/** Days before today the monitor findings cover: recently worked shifts. */
export const STATUTORY_MONITOR_LOOKBACK_DAYS = 7;
/** Days after today the monitor findings cover: the planning horizon. */
export const STATUTORY_MONITOR_LOOKAHEAD_DAYS = 56;

/**
 * The monitors whose review lists hold only acknowledgeable findings: their other findings are
 * read here. Working-student and on-call review lists already carry every finding.
 */
const monitorOnlyContributors: readonly StatutoryScheduleContributor[] = [
	minijobScheduleContributor,
	shortTermScheduleContributor,
	jarbschgScheduleContributor,
	apprenticeReleaseScheduleContributor,
];

export interface StatutoryReviewInboxItem {
	/** The finding id (`statutoryFindingId`). */
	readonly id: string;
	readonly reviewDomain: StatutoryReviewDomain;
	readonly domain: StatutoryDomain;
	readonly employeeId: string;
	readonly employeeName: string;
	/** The monitor's finding kind, e.g. `minijob_monthly_cap`. */
	readonly kind: string;
	readonly severity: StatutorySeverity;
	readonly subjectKey: string;
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly legalReference: string;
	/** Null when the finding cannot be acknowledged. */
	readonly acknowledgementKind: StatutoryAcknowledgementKind | null;
	/** Null when the finding cannot be acknowledged. */
	readonly acknowledgementStatus: "none" | "current" | "stale" | null;
	/** Whether an org admin can document the finding now (an acknowledgement kind alone is not enough, e.g. a third Minijob exceedance). */
	readonly acknowledgeable: boolean;
	/** `review`: from the domain's review list (with its acknowledgement form); `monitor`: a finding only the monitor reports. */
	readonly source: "review" | "monitor";
	/** Monitor findings only: the wage-free projection Scheduling shows, for its warning text. */
	readonly warning?: StatutoryComplianceFinding;
}

export interface StatutoryReviewDomainSummary {
	readonly domain: StatutoryReviewDomain;
	readonly status: "loaded" | "unavailable";
	/** Open findings by severity. */
	readonly critical: number;
	readonly warning: number;
	/** Open findings an org admin can document and nobody has yet. */
	readonly pendingAcknowledgements: number;
	/** Acknowledgements invalidated by newer work, shifts or figures. */
	readonly staleAcknowledgements: number;
}

export interface StatutoryReviewInbox {
	readonly items: readonly StatutoryReviewInboxItem[];
	readonly domains: readonly StatutoryReviewDomainSummary[];
}

export interface StatutoryReviewInboxRequest {
	readonly organizationId: string;
	readonly now: Instant;
	/** Also list findings documented by a current acknowledgement. */
	readonly includeResolved?: boolean;
}

function itemOf(
	finding: StatutoryFinding,
	employeeName: string,
	source: StatutoryReviewInboxItem["source"],
): StatutoryReviewInboxItem {
	const acknowledgementStatus = finding.acknowledgementKind
		? (finding.acknowledgement?.status ?? "none")
		: null;
	return {
		id: finding.id,
		reviewDomain: statutoryReviewDomainOf(finding.domain),
		domain: finding.domain,
		employeeId: finding.employeeId,
		employeeName,
		kind: finding.kind,
		severity: finding.severity,
		subjectKey: finding.subjectKey,
		periodStart: finding.periodStart,
		periodEnd: finding.periodEnd,
		legalReference: finding.legalReference,
		acknowledgementKind: finding.acknowledgementKind,
		acknowledgementStatus,
		acknowledgeable: finding.acknowledgementKind !== null,
		source,
	};
}

async function employeeNames(
	db: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await db
		.select({
			id: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			name: user.name,
			email: user.email,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	return new Map(rows.map((row) => [row.id, buildAuthUserDisplayName(row) || row.id]));
}

/**
 * Findings of the monitors that only list acknowledgeable findings for review, in the planning
 * horizon around today, for the organization's current roster. Acknowledgeable findings are left
 * to the review lists, which judge them over their own periods.
 */
export async function loadStatutoryMonitorFindings(
	db: Reader,
	input: { readonly organizationId: string; readonly timezone: string; readonly now: Instant },
): Promise<StatutoryReviewInboxItem[]> {
	const roster = await db
		.select({ id: employee.id })
		.from(employee)
		.where(onCurrentRoster(input.organizationId, employee, input.now));
	if (roster.length === 0) return [];
	const today = plainDateAt(input.now, input.timezone);
	const findings = (
		await evaluateStatutoryFindings(
			db,
			{
				organizationId: input.organizationId,
				timezone: input.timezone,
				window: {
					start: today.subtract({ days: STATUTORY_MONITOR_LOOKBACK_DAYS }).toString(),
					endExclusive: today.add({ days: STATUTORY_MONITOR_LOOKAHEAD_DAYS + 1 }).toString(),
				},
				employeeIds: roster.map((row) => row.id),
				now: input.now,
			},
			monitorOnlyContributors,
		)
	).filter((finding) => finding.acknowledgementKind === null && finding.severity !== "info");
	const names = await employeeNames(db, input.organizationId, [
		...new Set(findings.map((finding) => finding.employeeId)),
	]);
	const seen = new Set<string>();
	const items: StatutoryReviewInboxItem[] = [];
	for (const finding of findings) {
		if (seen.has(finding.id)) continue;
		seen.add(finding.id);
		items.push({
			...itemOf(finding, names.get(finding.employeeId) ?? finding.employeeId, "monitor"),
			warning: toStatutoryComplianceFinding(finding),
		});
	}
	return items;
}

/** Review items of each domain's own review list, with every acknowledgement state. */
const reviewLoaders: Record<
	StatutoryReviewDomain,
	(
		db: Reader,
		input: { organizationId: string; timezone: string; now: Instant },
	) => Promise<StatutoryReviewInboxItem[]>
> = {
	async minijob(db, input) {
		const reviews = await loadMinijobExceedanceReviews(db, { ...input, includeAcknowledged: true });
		return reviews.map((review) => ({
			id: review.id,
			reviewDomain: "minijob",
			domain: "minijob",
			employeeId: review.employeeId,
			employeeName: review.employeeName,
			kind: MINIJOB_MONTHLY_FINDING,
			severity: review.severity,
			subjectKey: review.month,
			periodStart: firstDayOf(review.month),
			periodEnd: firstDayOf(addMonths(review.month, 1)),
			legalReference: MINIJOB_EXCEEDANCE_LEGAL_REFERENCE,
			acknowledgementKind: MINIJOB_EXCEEDANCE_ACKNOWLEDGEMENT,
			acknowledgementStatus: review.acknowledgement.status,
			acknowledgeable: review.acknowledgeable,
			source: "review",
		}));
	},
	async short_term(db, input) {
		const reviews = await listShortTermBerufsmaessigkeitReviews(db, {
			...input,
			includeResolved: true,
		});
		return reviews.map((review) => itemOf(review.finding, review.employeeName, "review"));
	},
	async working_student(db, input) {
		const items = await listWorkingStudentReviewItems(db, input);
		return items.map((item) => itemOf(item.finding, item.employeeName, "review"));
	},
	async on_call(db, input) {
		const items = await listOnCallReviewItems(db, input);
		return items.map((item) => itemOf(item.finding, item.employeeName, "review"));
	},
	async youth_apprentice(db, input) {
		const findings = await listOpenYouthSectorExceptions(db, {
			...input,
			includeAcknowledged: true,
		});
		return findings.map((finding) => ({
			id: finding.findingId,
			reviewDomain: "youth_apprentice",
			domain: "youth_protection",
			employeeId: finding.employeeId,
			employeeName: finding.employeeName,
			kind: finding.findingKind,
			severity: finding.severity,
			subjectKey: finding.subjectKey,
			periodStart: finding.periodStart,
			periodEnd: finding.periodEnd,
			legalReference: finding.legalReference,
			acknowledgementKind: "jarbschg_sector_exception",
			acknowledgementStatus: finding.acknowledgementStatus,
			acknowledgeable: true,
			source: "review",
		}));
	},
};

/** Whether an item still needs an org admin: not documented by a current acknowledgement. */
export function isOpenStatutoryReviewItem(item: StatutoryReviewInboxItem): boolean {
	return item.severity !== "info" && item.acknowledgementStatus !== "current";
}

export function summarizeStatutoryReviewDomain(
	domain: StatutoryReviewDomain,
	items: readonly StatutoryReviewInboxItem[],
): StatutoryReviewDomainSummary {
	const open = items.filter(
		(item) => item.reviewDomain === domain && isOpenStatutoryReviewItem(item),
	);
	return {
		domain,
		status: "loaded",
		critical: open.filter((item) => item.severity === "critical").length,
		warning: open.filter((item) => item.severity === "warning").length,
		pendingAcknowledgements: open.filter(
			(item) => item.acknowledgeable && item.acknowledgementStatus === "none",
		).length,
		staleAcknowledgements: open.filter((item) => item.acknowledgementStatus === "stale").length,
	};
}

/**
 * The organization's statutory review inbox: open findings and pending or stale acknowledgements
 * of every domain, most severe first, with a summary per domain. The domains load concurrently, so
 * pass a pool-backed client, not a transaction.
 */
export async function loadStatutoryReviewInbox(
	db: Reader,
	input: StatutoryReviewInboxRequest,
): Promise<StatutoryReviewInbox> {
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const context = { organizationId: input.organizationId, timezone, now: input.now };
	const [monitor, ...reviews] = await Promise.allSettled([
		loadStatutoryMonitorFindings(db, context),
		...statutoryReviewDomains.map((domain) => reviewLoaders[domain](db, context)),
	]);

	const unavailable = new Set<StatutoryReviewDomain>();
	const all: StatutoryReviewInboxItem[] = [];
	const seen = new Set<string>();
	for (const [index, result] of reviews.entries()) {
		const domain = statutoryReviewDomains[index];
		if (result.status === "rejected") {
			console.error(`[statutory-review-inbox] ${domain} review list failed`, result.reason);
			unavailable.add(domain);
			continue;
		}
		for (const item of result.value) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			all.push(item);
		}
	}
	if (monitor.status === "rejected") {
		console.error("[statutory-review-inbox] monitor findings failed", monitor.reason);
		for (const domain of ["minijob", "short_term", "youth_apprentice"] as const) {
			unavailable.add(domain);
		}
	} else {
		for (const item of monitor.value) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			all.push(item);
		}
	}

	const severityRank: Record<StatutorySeverity, number> = { critical: 0, warning: 1, info: 2 };
	const items = all
		.filter((item) => input.includeResolved || isOpenStatutoryReviewItem(item))
		.sort(
			(a, b) =>
				severityRank[a.severity] - severityRank[b.severity] ||
				a.periodStart.localeCompare(b.periodStart) ||
				a.employeeName.localeCompare(b.employeeName) ||
				a.id.localeCompare(b.id),
		);
	const domains = statutoryReviewDomains.map((domain) =>
		unavailable.has(domain)
			? {
					...summarizeStatutoryReviewDomain(domain, all),
					status: "unavailable" as const,
				}
			: summarizeStatutoryReviewDomain(domain, all),
	);
	return { items, domains };
}
