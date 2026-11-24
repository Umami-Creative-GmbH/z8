/**
 * Minijob exceedance months for Settings → Contracts → Reviews & Conflicts (#1989). Org-admin
 * data: amounts are EUR cents. Covers the last 12 months through every month the statutory review
 * inbox's planning horizon touches (`review-window.ts`), so planned shifts that would exceed the
 * cap appear before they are worked, and the inbox never leaves a month to a list that skips it.
 */
import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { StatutoryAcknowledgementReviewStatus } from "../acknowledgement-history";
import type { StatutoryFinding, StatutorySeverity } from "../finding";
import { loadOrganizationStatutoryPreferences, type StatutoryPreferences } from "../preferences";
import { statutoryReviewWindow } from "../review-window";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import {
	addMonths,
	firstDayOf,
	MINIJOB_MONTHLY_FINDING,
	type MinijobExceedanceStatus,
	type MinijobFindingKind,
} from "./minijob-months";
import { loadMinijobCandidates } from "./minijob-terms";

type Reader = Pick<DatabaseClient, "select">;

export interface MinijobExceedanceReview {
	/** `StatutoryFinding.id`. */
	readonly id: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly month: string;
	readonly severity: StatutorySeverity;
	readonly status: MinijobExceedanceStatus;
	readonly acknowledgeable: boolean;
	readonly totalCents: number;
	readonly capCents: number;
	readonly doubleCapCents: number | null;
	readonly externalCents: number;
	readonly plannedCents: number;
	readonly priorExceedanceMonths: readonly string[];
	/** What these figures are: sent back as the acknowledgement's precondition. Org admins only. */
	readonly inputFingerprint: string;
	readonly acknowledgement: {
		/**
		 * Whether the month's acknowledgement documents it. `no_longer_applies`: it still matches
		 * the month's figures, but the month turned into a third exceedance or went above twice
		 * the cap, which no acknowledgement documents.
		 */
		readonly status: StatutoryAcknowledgementReviewStatus;
		readonly acknowledgedAt: Date | null;
		readonly acknowledgedBy: string | null;
		readonly reason: string | null;
	};
}

function personName(row: {
	firstName: string | null;
	lastName: string | null;
	userName: string | null;
	email: string | null;
	employeeId: string;
}): string {
	const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
	return full || row.userName || row.email || row.employeeId;
}

/** The months the review list covers around `now`, `[from, until)` as `YYYY-MM`. */
export function minijobReviewMonths(
	now: Instant,
	timezone: string,
): { readonly from: string; readonly until: string } {
	const today = plainDateAt(now, timezone);
	const lastDay = parsePlainDate(statutoryReviewWindow(today).endExclusive).subtract({ days: 1 });
	return {
		from: addMonths(today.toString().slice(0, 7), -11),
		until: addMonths(lastDay.toString().slice(0, 7), 1),
	};
}

/**
 * Every Minijob finding of the review list's months (`minijobReviewMonths`): exceedances with their
 * acknowledgement state, usage tiers and the rolling 12-month cap. The statutory review inbox reads
 * both its Minijob review items and its other Minijob findings from this one evaluation.
 */
export async function evaluateMinijobReviewFindings(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly preferences: StatutoryPreferences;
	},
): Promise<StatutoryFinding<MinijobFindingKind>[]> {
	const months = minijobReviewMonths(input.now, input.timezone);
	// Findings only exist for months on Minijob terms: long-departed Minijobbers are not evaluated.
	const employeeIds = await loadMinijobCandidates(db, {
		organizationId: input.organizationId,
		from: firstDayOf(months.from),
		until: firstDayOf(months.until),
	});
	if (employeeIds.length === 0) return [];
	const { findings } = await evaluateMinijobEarnings(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		employeeIds,
		months,
		preferences: input.preferences,
		now: input.now,
	});
	return findings;
}

/** Whether a Minijob finding is an exceedance month the review list carries. */
export function isMinijobExceedanceReviewFinding(finding: StatutoryFinding): boolean {
	return finding.kind === MINIJOB_MONTHLY_FINDING && finding.acknowledgementKind !== null;
}

/** Whether a current acknowledgement documents the exceedance month (it qualifies for one). */
function isDocumented(finding: StatutoryFinding): boolean {
	return finding.adminDetail?.facts?.exceedanceStatus === "acknowledged";
}

/**
 * Whether the month's acknowledgement documents it: the evaluation judges each month's
 * acknowledgement by fingerprint and total, and only a month that still qualifies is documented.
 */
export function minijobAcknowledgementReviewStatus(
	finding: StatutoryFinding,
): StatutoryAcknowledgementReviewStatus {
	const status = finding.acknowledgement?.status ?? "none";
	return status === "current" && !isDocumented(finding) ? "no_longer_applies" : status;
}

/**
 * The exceedance months of evaluated Minijob findings, newest month first. `names` gives each
 * employee's display name (the employee id stands in for a missing one).
 */
export function minijobExceedanceReviewsOf(
	findings: readonly StatutoryFinding[],
	input: {
		readonly includeAcknowledged?: boolean;
		readonly names: ReadonlyMap<string, string>;
	},
): MinijobExceedanceReview[] {
	return findings
		.filter(isMinijobExceedanceReviewFinding)
		.filter((finding) => input.includeAcknowledged || !isDocumented(finding))
		.map((finding): MinijobExceedanceReview => {
			const amounts = finding.adminDetail?.amountsCents ?? {};
			const facts = finding.adminDetail?.facts ?? {};
			const prior =
				typeof facts.priorExceedanceMonths === "string" ? facts.priorExceedanceMonths : "";
			return {
				id: finding.id,
				employeeId: finding.employeeId,
				employeeName: input.names.get(finding.employeeId) ?? finding.employeeId,
				month: finding.subjectKey,
				severity: finding.severity,
				status: facts.exceedanceStatus as MinijobExceedanceStatus,
				acknowledgeable: facts.acknowledgeable === true,
				totalCents: amounts.total ?? 0,
				capCents: amounts.cap ?? 0,
				doubleCapCents: amounts.doubleCap ?? null,
				externalCents: amounts.external ?? 0,
				plannedCents: amounts.planned ?? 0,
				priorExceedanceMonths: prior ? prior.split(",") : [],
				inputFingerprint: finding.inputFingerprint,
				acknowledgement: {
					status: minijobAcknowledgementReviewStatus(finding),
					acknowledgedAt: finding.acknowledgement?.acknowledgedAt ?? null,
					acknowledgedBy: finding.acknowledgement?.acknowledgedBy ?? null,
					reason: finding.acknowledgement?.reason ?? null,
				},
			};
		})
		.sort((a, b) =>
			a.month === b.month
				? a.employeeName.localeCompare(b.employeeName)
				: a.month < b.month
					? 1
					: -1,
		);
}

export async function loadMinijobExceedanceReviews(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly now: Instant;
		/** Include months already documented by a current acknowledgement. */
		readonly includeAcknowledged?: boolean;
	},
): Promise<MinijobExceedanceReview[]> {
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const findings = await evaluateMinijobReviewFindings(db, {
		organizationId: input.organizationId,
		timezone,
		now: input.now,
		preferences: await loadOrganizationStatutoryPreferences(db, input.organizationId),
	});
	const shown = minijobExceedanceReviewsOf(findings, {
		includeAcknowledged: input.includeAcknowledged,
		names: new Map(),
	});
	if (shown.length === 0) return [];

	const names = await db
		.select({
			employeeId: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			userName: user.name,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, [...new Set(shown.map((review) => review.employeeId))]),
			),
		);
	return minijobExceedanceReviewsOf(findings, {
		includeAcknowledged: input.includeAcknowledged,
		names: new Map(names.map((row) => [row.employeeId, personName(row)])),
	});
}
