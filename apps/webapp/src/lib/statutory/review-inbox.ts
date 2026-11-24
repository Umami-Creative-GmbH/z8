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
 * conflicts) within the planning horizon (`review-window.ts`), which every review list covers.
 *
 * One load evaluates each monitor once: the Minijob review months and the JArbSchG and apprentice
 * horizon each give both their review items and their other findings, and every read goes through
 * one request-scoped `memoizedReader`, so the timezone, preferences, roster and the data several
 * monitors share are read once. A domain that fails to load is reported `unavailable` instead of
 * failing the whole inbox.
 */
import { employee } from "@/db/schema";
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { StatutoryAcknowledgementReviewStatus } from "./acknowledgement-history";
import type { StatutoryAcknowledgementKind } from "./acknowledgement-kinds";
import { employeeDisplayNames } from "./employee-display-names";
import { apprenticeReleaseScheduleContributor } from "./apprenticeship/release-conflict-contributor";
import type { StatutoryFinding, StatutorySeverity } from "./finding";
import {
	evaluateMinijobReviewFindings,
	isMinijobExceedanceReviewFinding,
	minijobAcknowledgementReviewStatus,
} from "./minijob/minijob-reviews";
import { minijobScheduleContributor } from "./minijob/minijob-schedule-contributor";
import { listOnCallReviewItems } from "./on-call/views";
import { loadOrganizationStatutoryPreferences } from "./preferences";
import {
	type StatutoryReviewDomain,
	statutoryReviewDomainOf,
	statutoryReviewDomains,
} from "./review-domains";
import { isOpenStatutoryReviewItem, summarizeStatutoryReviewDomain } from "./review-summary";
import { statutoryReviewWindow } from "./review-window";
import type { StatutoryScheduleContributor } from "./scheduling/contributor";
import { evaluateStatutoryFindings, toStatutoryComplianceFinding } from "./scheduling/evaluate";
import { memoizedReader } from "./scheduling/read-memo";
import { shortTermScheduleContributor } from "./short-term/contributor";
import { listShortTermBerufsmaessigkeitReviews } from "./short-term/monitor";
import type { StatutoryDomain } from "./threshold-catalog";
import { listWorkingStudentReviewItems } from "./working-student/views";
import { jarbschgScheduleContributor } from "./youth/jarbschg-contributor";
import { evaluateMinorContractorReviewFindings } from "./youth/minor-contractor-review";
import { isYouthSectorExceptionFinding } from "./youth/sector-exception-review";

type Reader = Pick<DatabaseClient, "select" | "query">;

export {
	statutoryReviewDomainOf,
	statutoryReviewDomains,
	type StatutoryReviewDomain,
} from "./review-domains";
export { STATUTORY_MONITOR_LOOKAHEAD_DAYS, STATUTORY_MONITOR_LOOKBACK_DAYS } from "./review-window";
/** The monitors whose horizon findings the inbox reads beside their review lists. */
const youthContributors: readonly StatutoryScheduleContributor[] = [
	jarbschgScheduleContributor,
	apprenticeReleaseScheduleContributor,
];

export interface StatutoryReviewInboxItem {
	/** The finding id (`statutoryFindingId`). */
	readonly id: string;
	readonly reviewDomain: StatutoryReviewDomain;
	readonly domain: StatutoryDomain;
	readonly employeeId: string;
	/** Empty when the inbox was loaded for counts only. */
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
	/**
	 * Whether an acknowledgement documents the finding, as its monitor judged (`current` only
	 * while the finding still qualifies for one). Null when the finding cannot be acknowledged.
	 */
	readonly acknowledgementStatus: StatutoryAcknowledgementReviewStatus | null;
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
	/** For counts (the Command Center): items carry no employee names, and none are read. */
	readonly countsOnly?: boolean;
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

/** A Minijob exceedance month of the review list: documented only while it qualifies. */
function minijobReviewItemOf(finding: StatutoryFinding): StatutoryReviewInboxItem {
	return {
		...itemOf(finding, "", "review"),
		acknowledgementStatus: minijobAcknowledgementReviewStatus(finding),
		acknowledgeable: finding.adminDetail?.facts?.acknowledgeable === true,
	};
}

function monitorItemOf(finding: StatutoryFinding): StatutoryReviewInboxItem {
	return { ...itemOf(finding, "", "monitor"), warning: toStatutoryComplianceFinding(finding) };
}

/** Findings no review list carries: they cannot be acknowledged. */
function isMonitorOnlyFinding(finding: StatutoryFinding): boolean {
	return finding.acknowledgementKind === null && finding.severity !== "info";
}

/** Gives items without a name (read here, not by their review list) their employee's name. */
async function withEmployeeNames(
	db: Reader,
	organizationId: string,
	items: readonly StatutoryReviewInboxItem[],
): Promise<StatutoryReviewInboxItem[]> {
	const unnamed = items.filter((item) => item.employeeName === "");
	const names = await employeeDisplayNames(db, organizationId, [
		...new Set(unnamed.map((item) => item.employeeId)),
	]);
	return items.map((item) =>
		item.employeeName === ""
			? { ...item, employeeName: names.get(item.employeeId) || item.employeeId }
			: item,
	);
}

interface InboxContext {
	readonly organizationId: string;
	readonly timezone: string;
	readonly now: Instant;
	readonly window: { readonly start: string; readonly endExclusive: string };
	readonly withNames: boolean;
	/** The organization's current roster, read once per load. */
	readonly roster: () => Promise<readonly string[]>;
}

function inboxContext(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly withNames: boolean;
	},
): InboxContext {
	let roster: Promise<readonly string[]> | null = null;
	return {
		...input,
		window: statutoryReviewWindow(plainDateAt(input.now, input.timezone)),
		roster: () => {
			roster ??= db
				.select({ id: employee.id })
				.from(employee)
				.where(onCurrentRoster(input.organizationId, employee, input.now))
				.then((rows) => rows.map((row) => row.id));
			return roster;
		},
	};
}

/** The horizon's findings of `contributors` for the current roster, acknowledgements attached. */
async function horizonFindings(
	db: Reader,
	context: InboxContext,
	contributors: readonly StatutoryScheduleContributor[],
): Promise<StatutoryFinding[]> {
	const employeeIds = await context.roster();
	if (employeeIds.length === 0) return [];
	return evaluateStatutoryFindings(
		db,
		{
			organizationId: context.organizationId,
			timezone: context.timezone,
			window: context.window,
			employeeIds,
			now: context.now,
		},
		contributors,
	);
}

/** Whether a Minijob finding judges a month the horizon touches, for an employee on the roster. */
function inHorizonMonths(context: InboxContext, roster: ReadonlySet<string>) {
	const firstMonth = context.window.start.slice(0, 7);
	const lastMonth = parsePlainDate(context.window.endExclusive)
		.subtract({ days: 1 })
		.toString()
		.slice(0, 7);
	return (finding: StatutoryFinding) =>
		roster.has(finding.employeeId) &&
		finding.subjectKey >= firstMonth &&
		finding.subjectKey <= lastMonth;
}

/** Each domain's items: its review list's, and the findings only its monitor reports. */
const domainLoaders: Record<
	StatutoryReviewDomain,
	(db: Reader, context: InboxContext) => Promise<StatutoryReviewInboxItem[]>
> = {
	async minijob(db, context) {
		// One evaluation: the review months cover every month the horizon touches.
		const [findings, roster] = await Promise.all([
			evaluateMinijobReviewFindings(db, {
				organizationId: context.organizationId,
				timezone: context.timezone,
				now: context.now,
				preferences: await loadOrganizationStatutoryPreferences(db, context.organizationId),
			}),
			context.roster(),
		]);
		const inHorizon = inHorizonMonths(context, new Set(roster));
		return [
			...findings.filter(isMinijobExceedanceReviewFinding).map(minijobReviewItemOf),
			...findings
				.filter((finding) => isMonitorOnlyFinding(finding) && inHorizon(finding))
				.map(monitorItemOf),
		];
	},
	async short_term(db, context) {
		const [reviews, findings] = await Promise.all([
			listShortTermBerufsmaessigkeitReviews(db, {
				organizationId: context.organizationId,
				timezone: context.timezone,
				now: context.now,
				includeResolved: true,
				withNames: context.withNames,
			}),
			horizonFindings(db, context, [shortTermScheduleContributor]),
		]);
		return [
			...reviews.map((review) => itemOf(review.finding, review.employeeName, "review")),
			...findings.filter(isMonitorOnlyFinding).map(monitorItemOf),
		];
	},
	async working_student(db, context) {
		const items = await listWorkingStudentReviewItems(db, {
			organizationId: context.organizationId,
			now: context.now,
			withNames: context.withNames,
		});
		return items.map((item) => itemOf(item.finding, item.employeeName, "review"));
	},
	async on_call(db, context) {
		const items = await listOnCallReviewItems(db, {
			organizationId: context.organizationId,
			timezone: context.timezone,
			now: context.now,
			withNames: context.withNames,
		});
		return items.map((item) => itemOf(item.finding, item.employeeName, "review"));
	},
	async youth_apprentice(db, context) {
		// One evaluation: the sector-exception list covers the same horizon.
		const [findings, minorContractors] = await Promise.all([
			horizonFindings(db, context, youthContributors),
			// #2022: minor contractor engagements over the same horizon and roster, from the birthdays
			// and engagement periods the youth protection monitor reads (once, through `db`'s memo).
			context.roster().then((currentRoster) =>
				evaluateMinorContractorReviewFindings(db, {
					organizationId: context.organizationId,
					timezone: context.timezone,
					now: context.now,
					currentRoster,
				}),
			),
		]);
		return [
			...findings
				.filter(isYouthSectorExceptionFinding)
				.map((finding) => itemOf(finding, "", "review")),
			...minorContractors.map((finding) => itemOf(finding, "", "review")),
			...findings.filter(isMonitorOnlyFinding).map(monitorItemOf),
		];
	},
};

/** Items listed once each, in the order the domains gave them. */
function uniqueItems(items: Iterable<StatutoryReviewInboxItem>): StatutoryReviewInboxItem[] {
	const seen = new Set<string>();
	const unique: StatutoryReviewInboxItem[] = [];
	for (const item of items) {
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		unique.push(item);
	}
	return unique;
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
	const reader = memoizedReader(db);
	const context = inboxContext(reader, { ...input, withNames: true });
	const findings = await horizonFindings(reader, context, [
		minijobScheduleContributor,
		shortTermScheduleContributor,
		...youthContributors,
	]);
	return withEmployeeNames(
		reader,
		input.organizationId,
		uniqueItems(findings.filter(isMonitorOnlyFinding).map(monitorItemOf)),
	);
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
	const reader = memoizedReader(db);
	const context = inboxContext(reader, {
		organizationId: input.organizationId,
		timezone: await loadOrganizationTimezone(reader, input.organizationId),
		now: input.now,
		withNames: !input.countsOnly,
	});
	const results = await Promise.allSettled(
		statutoryReviewDomains.map((domain) => domainLoaders[domain](reader, context)),
	);

	const unavailable = new Set<StatutoryReviewDomain>();
	const loaded: StatutoryReviewInboxItem[] = [];
	for (const [index, result] of results.entries()) {
		const domain = statutoryReviewDomains[index];
		if (result.status === "rejected") {
			console.error(`[statutory-review-inbox] ${domain} findings failed`, result.reason);
			unavailable.add(domain);
			continue;
		}
		loaded.push(...result.value);
	}
	const unique = uniqueItems(loaded);
	const all = input.countsOnly
		? unique.map((item) => ({ ...item, employeeName: "" }))
		: await withEmployeeNames(reader, input.organizationId, unique);

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
