/**
 * Minor contractors for youth-protection review (#2022). External Contractor days are no
 * employee's (#1996), so the JArbSchG monitor does not judge them. But § 1 Abs. 1 Nr. 3 JArbSchG
 * also covers minors who perform services similar to an employee's work, so a contractor under 18
 * may still fall under youth protection. Unless the organization judges minor contractors fully
 * under JArbSchG (`applyJarbschgToMinorContractors`), each contractor engagement that decides a
 * contractor day of a minor (the days the monitor skips, `engagementKindOnDay`) is one warning an
 * org admin reviews and documents with a reason. Its fingerprint covers the engagement period and
 * the birthday, so the documentation re-opens when either changes.
 */
import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { loadEmploymentPeriodSnapshots } from "@/lib/contracts/employment-profile-intervals";
import {
	type EmploymentPeriodSnapshot,
	engagementPeriodDecidingDay,
} from "@/lib/contracts/resolve-contract";
import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import {
	attachAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import { loadOrganizationStatutoryPreferences, type StatutoryPreferences } from "../preferences";
import { statutoryReviewWindow } from "../review-window";
import { isMinorOn } from "./age";
import { loadEmployeeBirthdays, loadEmployeeEngagementKinds } from "./youth-facts";

type Reader = Pick<DatabaseClient, "select">;

export const MINOR_CONTRACTOR_FINDING_KIND = "jarbschg_minor_contractor";
export type MinorContractorFindingKind = typeof MINOR_CONTRACTOR_FINDING_KIND;
export const MINOR_CONTRACTOR_LEGAL_REFERENCE = "§ 1 Abs. 1 Nr. 3 JArbSchG";

/** The subject of an employee with no recorded stint, judged by `employee.engagement_kind`. */
const UNRECORDED_ENGAGEMENT = "employee";

export type MinorContractorFinding = StatutoryFinding<MinorContractorFindingKind>;

interface Engagement {
	readonly key: string;
	/** First local day, null when the stint's start was not recorded. */
	readonly start: PlainDate | null;
	/** Local day after the last, null while open-ended. */
	readonly endExclusive: PlainDate | null;
	/** What the review documents: the stint's recorded bounds. */
	readonly fingerprintInput: Readonly<Record<string, string | null>>;
}

function engagementOf(period: EmploymentPeriodSnapshot, timezone: string): Engagement {
	const startedAt =
		period.startProvenance === "recorded" && period.startedAt ? period.startedAt : null;
	return {
		key: period.id,
		start: startedAt ? plainDateAt(startedAt, timezone) : null,
		// `[startedAt, endedAt)`: the last day is the one holding the stint's last instant.
		endExclusive: period.endedAt
			? plainDateAt(period.endedAt.subtract({ nanoseconds: 1 }), timezone).add({ days: 1 })
			: null,
		fingerprintInput: {
			engagementPeriodId: period.id,
			startedAt: startedAt?.toString() ?? null,
			endedAt: period.endedAt?.toString() ?? null,
		},
	};
}

const UNRECORDED: Engagement = {
	key: UNRECORDED_ENGAGEMENT,
	start: null,
	endExclusive: null,
	fingerprintInput: { engagementPeriodId: null },
};

/** The contractor days of one deciding engagement inside the window. */
interface ContractorDays {
	readonly engagement: Engagement;
	/** Its first contractor day in the window. */
	readonly firstDay: PlainDate;
	/** A day after the stint ended still counts as its contractor day. */
	afterEnd: boolean;
	/** A day before the first stint started counts as its contractor day. */
	beforeStart: boolean;
}

/**
 * The window's contractor days, grouped by the engagement that decides each one, exactly as the
 * youth protection monitor skips them (`loadContractorDays` → `engagementKindOnDay`): days in a
 * contractor stint, days after a contractor stint ended with no later one, days before a first
 * contractor stint, and every day of a contractor with no recorded stint.
 */
function contractorDaysByEngagement(input: {
	readonly employeeEngagementKind: EngagementKind;
	readonly periods: readonly EmploymentPeriodSnapshot[];
	readonly timezone: string;
	readonly windowStart: PlainDate;
	readonly windowEnd: PlainDate;
}): ContractorDays[] {
	const byKey = new Map<string, ContractorDays>();
	if (input.periods.length === 0) {
		if (input.employeeEngagementKind !== "contractor") return [];
		if (comparePlainDates(input.windowStart, input.windowEnd) >= 0) return [];
		return [
			{ engagement: UNRECORDED, firstDay: input.windowStart, afterEnd: false, beforeStart: false },
		];
	}
	if (!input.periods.some((period) => period.engagementKind === "contractor")) return [];
	for (
		let day = input.windowStart;
		comparePlainDates(day, input.windowEnd) < 0;
		day = day.add({ days: 1 })
	) {
		const decided = engagementPeriodDecidingDay(input.periods, day, input.timezone);
		if (decided?.period.engagementKind !== "contractor") continue;
		let days = byKey.get(decided.period.id);
		if (!days) {
			days = {
				engagement: engagementOf(decided.period, input.timezone),
				firstDay: day,
				afterEnd: false,
				beforeStart: false,
			};
			byKey.set(decided.period.id, days);
		}
		if (decided.position === "after_end") days.afterEnd = true;
		if (decided.position === "before_start") days.beforeStart = true;
	}
	return [...byKey.values()];
}

/**
 * One review finding per engagement that decides a contractor day of the employee inside `window`
 * on which they are under 18: the days the youth protection monitor skips. Pure: the caller loads
 * the stints, the birthday and the window.
 */
export function minorContractorEngagementFindings(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly birthday: PlainDate | null;
	readonly employeeEngagementKind: EngagementKind;
	readonly periods: readonly EmploymentPeriodSnapshot[];
	readonly timezone: string;
	readonly window: { readonly start: string; readonly endExclusive: string };
}): MinorContractorFinding[] {
	const { birthday } = input;
	if (!birthday) return [];
	const windowStart = parsePlainDate(input.window.start);
	const windowEnd = parsePlainDate(input.window.endExclusive);

	const findings: MinorContractorFinding[] = [];
	for (const { engagement, firstDay, afterEnd, beforeStart } of contractorDaysByEngagement({
		employeeEngagementKind: input.employeeEngagementKind,
		periods: input.periods,
		timezone: input.timezone,
		windowStart,
		windowEnd,
	})) {
		// Age only grows: a minor on any of its contractor days is a minor on the first one.
		if (!isMinorOn(birthday, firstDay)) continue;
		const subjectKey = `engagement:${engagement.key}`;
		findings.push({
			id: statutoryFindingId(MINOR_CONTRACTOR_FINDING_KIND, input.employeeId, subjectKey),
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			domain: "youth_protection",
			kind: MINOR_CONTRACTOR_FINDING_KIND,
			severity: "warning",
			subjectKey,
			periodStart: (engagement.start ?? firstDay).toString(),
			periodEnd: (engagement.endExclusive ?? windowEnd).toString(),
			legalReference: MINOR_CONTRACTOR_LEGAL_REFERENCE,
			summary: {},
			adminDetail: {
				facts: {
					openEnded: engagement.endExclusive === null,
					startRecorded: engagement.start !== null,
					// Not fingerprinted: the window moving past the end must not re-open a documentation.
					contractorAfterEnd: afterEnd,
					contractorBeforeStart: beforeStart,
				},
			},
			inputFingerprint: statutoryInputFingerprint({
				...engagement.fingerprintInput,
				birthday: birthday.toString(),
			}),
			acknowledgementKind: "jarbschg_minor_contractor_review",
			blocksPublication: false,
		});
	}
	return findings;
}

/**
 * The review findings of the organization's current roster over the statutory review window
 * (`review-window.ts`, the inbox's planning horizon), acknowledgement states attached. None while
 * the organization judges minor contractors under JArbSchG: the monitor judges their days then.
 */
export async function evaluateMinorContractorReviewFindings(
	db: Reader,
	input: {
		readonly organizationId: string;
		/** Organization calendar timezone: engagement days are local to it, as for the monitor. */
		readonly timezone: string;
		readonly now: Instant;
		readonly preferences?: Pick<StatutoryPreferences, "applyJarbschgToMinorContractors">;
		/** Only these employees (still only those on the organization's current roster). */
		readonly employeeIds?: readonly string[];
		/**
		 * The organization's current roster, when the caller already read it (the review inbox): it is
		 * not read again, and `employeeIds` is ignored.
		 */
		readonly currentRoster?: readonly string[];
	},
): Promise<MinorContractorFinding[]> {
	const preferences =
		input.preferences ?? (await loadOrganizationStatutoryPreferences(db, input.organizationId));
	if (preferences.applyJarbschgToMinorContractors) return [];
	const roster = input.currentRoster ?? (await currentRosterOf(db, input));
	if (roster.length === 0) return [];
	const window = statutoryReviewWindow(plainDateAt(input.now, input.timezone));
	const windowStart = parsePlainDate(window.start);
	// The same reads as the youth protection monitor's (`jarbschg-contributor.ts`), so a
	// request-scoped `memoizedReader` runs each once for both.
	const birthdays = await loadEmployeeBirthdays(db, {
		organizationId: input.organizationId,
		employeeIds: roster,
	});
	// Under 18 on any day of the window is under 18 on its first day.
	const minors = roster.flatMap((employeeId) => {
		const birthday = birthdays.get(employeeId) ?? null;
		return birthday && isMinorOn(birthday, windowStart) ? [{ employeeId, birthday }] : [];
	});
	if (minors.length === 0) return [];
	const scope = {
		organizationId: input.organizationId,
		employeeIds: minors.map((minor) => minor.employeeId),
	};
	const [engagementKinds, periodsOf] = await Promise.all([
		loadEmployeeEngagementKinds(db, scope),
		loadEmploymentPeriodSnapshots(db, scope),
	]);
	const findings = minors.flatMap(({ employeeId, birthday }) => {
		const employeeEngagementKind = engagementKinds.get(employeeId);
		if (!employeeEngagementKind) return [];
		return minorContractorEngagementFindings({
			organizationId: input.organizationId,
			employeeId,
			birthday,
			employeeEngagementKind,
			periods: periodsOf.get(employeeId) ?? [],
			timezone: input.timezone,
			window,
		});
	});
	if (findings.length === 0) return [];
	return attachAcknowledgementStates(db, input.organizationId, findings);
}

/** The organization's current roster, only `employeeIds` when given. */
async function currentRosterOf(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly now: Instant;
		readonly employeeIds?: readonly string[];
	},
): Promise<string[]> {
	if (input.employeeIds?.length === 0) return [];
	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				onCurrentRoster(input.organizationId, employee, input.now),
				input.employeeIds ? inArray(employee.id, [...new Set(input.employeeIds)]) : undefined,
			),
		);
	return rows.map((row) => row.id);
}

/** A minor contractor engagement for org admins in Reviews & Conflicts. */
export interface MinorContractorReview {
	readonly findingId: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly subjectKey: string;
	/**
	 * The engagement's first local day; null when its start was not recorded (no stint, or a legacy
	 * one). Never the review window's start, which moves every day.
	 */
	readonly periodStart: string | null;
	/** The day after its last; null while it is open-ended. */
	readonly periodEnd: string | null;
	/** It ended, but the person is still on the roster as a contractor on later days of the window. */
	readonly contractorAfterEnd: boolean;
	/** It has not started, but the person is already on the roster as a contractor before it. */
	readonly contractorBeforeStart: boolean;
	readonly legalReference: string;
	readonly acknowledgementStatus: "none" | "current" | "stale";
	/** What the admin documents; passed back as the expected precondition. */
	readonly inputFingerprint: string;
}

export type MinorContractorReviewRefusal =
	| "statutory_finding_not_found"
	| "statutory_finding_changed";

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
 * Open minor contractor engagements (not documented, or documented before the period or birthday
 * changed), earliest first; with `includeAcknowledged` also documented ones ("Show resolved").
 */
export async function listMinorContractorReviews(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly includeAcknowledged?: boolean;
	},
): Promise<MinorContractorReview[]> {
	const findings = (await evaluateMinorContractorReviewFindings(db, input)).filter(
		(finding) => input.includeAcknowledged || finding.acknowledgement?.status !== "current",
	);
	const names = await employeeNames(db, input.organizationId, [
		...new Set(findings.map((finding) => finding.employeeId)),
	]);
	return findings
		.map((finding): MinorContractorReview => {
			const facts = finding.adminDetail?.facts;
			return {
				findingId: finding.id,
				employeeId: finding.employeeId,
				employeeName: names.get(finding.employeeId) ?? finding.employeeId,
				subjectKey: finding.subjectKey,
				periodStart: facts?.startRecorded === true ? finding.periodStart : null,
				periodEnd: facts?.openEnded === true ? null : finding.periodEnd,
				contractorAfterEnd: facts?.contractorAfterEnd === true,
				contractorBeforeStart: facts?.contractorBeforeStart === true,
				legalReference: finding.legalReference,
				acknowledgementStatus: finding.acknowledgement?.status ?? "none",
				inputFingerprint: finding.inputFingerprint,
			};
		})
		.sort(
			(left, right) =>
				// An unrecorded start first: it may be the earliest.
				(left.periodStart ?? "").localeCompare(right.periodStart ?? "") ||
				left.employeeName.localeCompare(right.employeeName) ||
				left.findingId.localeCompare(right.findingId),
		);
}

/**
 * Documents one minor contractor engagement as an org admin. The engagement is judged again; the
 * acknowledgement records that judgement's subject and fingerprint, and only when the fingerprint
 * is the one the admin was shown (`expectedFingerprint`).
 */
export async function acknowledgeMinorContractorReview(
	db: Pick<DatabaseClient, "select" | "insert">,
	input: {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly employeeId: string;
		readonly subjectKey: string;
		readonly expectedFingerprint: string;
		readonly reason: string;
		readonly legalNote?: string | null;
	},
): Promise<StatutoryAcknowledgementRecord> {
	const findings = await evaluateMinorContractorReviewFindings(db, {
		organizationId: input.organizationId,
		timezone: input.timezone,
		now: input.now,
		employeeIds: [input.employeeId],
	});
	const finding = findings.find((candidate) => candidate.subjectKey === input.subjectKey);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw new ValidationError({
			message: "This contractor engagement no longer needs a youth protection review",
			refusal: "statutory_finding_not_found" satisfies MinorContractorReviewRefusal,
		});
	}
	if (finding.inputFingerprint !== input.expectedFingerprint) {
		throw new ValidationError({
			message: "The engagement or the birthday changed since you reviewed it. Review it again.",
			refusal: "statutory_finding_changed" satisfies MinorContractorReviewRefusal,
		});
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote,
	});
}
