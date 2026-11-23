/**
 * Working-student read models (#1991): the Employee Detail monitor card, the employee's own
 * non-sensitive status, the Reviews & Conflicts list, and the audited acknowledgement. Callers
 * authorize; every view a restricted reader gets is redacted here.
 */
import { and, eq, inArray } from "drizzle-orm";
import { employee } from "@/db/schema";
import {
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	attachAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { listEmployeeStatutoryOffsets, listEmployeeStudyPeriods } from "../employee-context";
import { loadEmployeeInOrganization } from "../employee-scope";
import {
	type RedactedStatutoryFinding,
	redactStatutoryFinding,
	type StatutoryAudience,
} from "../redaction";
import { evaluateWorkingStudents, loadWorkingStudentCandidates } from "./monitor";
import {
	mondayOf,
	type WorkingStudentFinding,
	type WorkingStudentFindingKind,
	type WorkingStudentWeek,
	workingStudentFindingKinds,
} from "./weeks";

type Reader = Pick<DatabaseClient, "select">;

/** Weeks the Employee Detail card shows around the current one. */
const CARD_PAST_WEEKS = 7;
const CARD_FUTURE_WEEKS = 4;
/** Weeks Reviews & Conflicts judges around the current one. */
const REVIEW_PAST_WEEKS = 26;
const REVIEW_FUTURE_WEEKS = 8;

export interface WorkingStudentRollingStatus {
	/** ISO week the balance is taken at (the current compliance week). */
	readonly asOfWeek: string;
	readonly usedWeeks: number;
	/** Null when no statutory baseline covers the week. */
	readonly limitWeeks: number | null;
	readonly remainingWeeks: number | null;
}

export interface WorkingStudentWeekView {
	readonly weekStart: string;
	readonly subjectKey: string;
	readonly totalMinutes: number;
	readonly coreMinutes: number;
	readonly lectureFreeMinutes: number;
	readonly eveningWeekendMinutes: number;
	/** Minutes on days under another employment profile; part of `totalMinutes`. */
	readonly otherProfileMinutes: number;
	readonly overLimit: boolean;
	readonly lectureBreach: boolean;
	readonly rollingOver20hWeeks: number;
}

export interface WorkingStudentLectureFreeView {
	readonly id: string;
	readonly startsOn: string;
	readonly endsOn: string;
	/** Org admins only. */
	readonly note?: string | null;
}

export interface WorkingStudentPriorWeeksView {
	readonly id: string;
	readonly firstWeekStartsOn: string;
	readonly count: number;
	readonly sourceEmployer: string | null;
	readonly note: string;
}

export type WorkingStudentFindingView =
	| WorkingStudentFinding
	| RedactedStatutoryFinding<WorkingStudentFindingKind>;

export interface WorkingStudentMonitorView {
	/** False when the employee never had working-student terms: there is nothing to show. */
	readonly applies: boolean;
	/** Whether the employee is a working student in the current compliance week. */
	readonly currentlyWorkingStudent: boolean;
	readonly audience: StatutoryAudience;
	readonly rolling: WorkingStudentRollingStatus | null;
	readonly weeks: readonly WorkingStudentWeekView[];
	readonly findings: readonly WorkingStudentFindingView[];
	readonly lectureFreePeriods: readonly WorkingStudentLectureFreeView[];
	/** Org admins only; null for restricted readers. */
	readonly priorWeeks: readonly WorkingStudentPriorWeeksView[] | null;
}

function rollingOf(week: WorkingStudentWeek | undefined): WorkingStudentRollingStatus | null {
	if (!week) return null;
	return {
		asOfWeek: week.subjectKey,
		usedWeeks: week.rollingOver20hWeeks,
		limitWeeks: week.ceilingWeeks,
		remainingWeeks:
			week.ceilingWeeks === null ? null : Math.max(0, week.ceilingWeeks - week.rollingOver20hWeeks),
	};
}

function weekView(week: WorkingStudentWeek): WorkingStudentWeekView {
	return {
		weekStart: week.weekStart,
		subjectKey: week.subjectKey,
		totalMinutes: week.totalMinutes,
		coreMinutes: week.coreMinutes,
		lectureFreeMinutes: week.lectureFreeMinutes,
		eveningWeekendMinutes: week.eveningWeekendMinutes,
		otherProfileMinutes: week.otherProfileMinutes,
		overLimit: week.overLimit,
		lectureBreach: week.lectureBreach,
		rollingOver20hWeeks: week.rollingOver20hWeeks,
	};
}

async function currentWeek(db: Reader, organizationId: string, now: Instant) {
	const timezone = await loadOrganizationTimezone(db, organizationId);
	return { timezone, monday: mondayOf(plainDateAt(now, timezone)) };
}

/**
 * The Employee Detail monitor card: recent and upcoming compliance weeks, the rolling balance, the
 * findings with their acknowledgement state, lecture-free periods and (org admins only) recorded
 * prior-employer weeks. The caller has checked the reader may see this employee.
 */
export async function loadWorkingStudentMonitor(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly now: Instant;
		readonly audience: StatutoryAudience;
	},
): Promise<WorkingStudentMonitorView> {
	await loadEmployeeInOrganization(db, input);
	const empty: WorkingStudentMonitorView = {
		applies: false,
		currentlyWorkingStudent: false,
		audience: input.audience,
		rolling: null,
		weeks: [],
		findings: [],
		lectureFreePeriods: [],
		priorWeeks: input.audience === "full" ? [] : null,
	};
	const [candidate] = await loadWorkingStudentCandidates(db, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
	});
	if (!candidate) return empty;

	const { timezone, monday } = await currentWeek(db, input.organizationId, input.now);
	const windowStart = monday.subtract({ weeks: CARD_PAST_WEEKS });
	const [evaluation] = await evaluateWorkingStudents(db, {
		organizationId: input.organizationId,
		timezone,
		window: {
			start: windowStart.toString(),
			endExclusive: monday.add({ weeks: CARD_FUTURE_WEEKS + 1 }).toString(),
		},
		employeeIds: [input.employeeId],
		now: input.now,
	});
	const findings = evaluation
		? await attachAcknowledgementStates(db, input.organizationId, evaluation.findings)
		: [];
	const shown = (evaluation?.weeks ?? []).filter(
		(week) => week.weekStart >= windowStart.toString(),
	);
	const current = shown.find((week) => week.weekStart === monday.toString());

	const periods = await listEmployeeStudyPeriods(db, input);
	const priorWeeks =
		input.audience === "full"
			? (
					await listEmployeeStatutoryOffsets(db, {
						...input,
						kinds: ["prior_working_student_over_20h_weeks"],
					})
				).map((row) => ({
					id: row.id,
					firstWeekStartsOn: row.validFromDate,
					count: row.countValue ?? 0,
					sourceEmployer: row.sourceEmployer,
					note: row.note,
				}))
			: null;

	return {
		applies: true,
		currentlyWorkingStudent: current?.isWorkingStudentWeek ?? false,
		audience: input.audience,
		rolling: current?.isWorkingStudentWeek ? rollingOf(current) : null,
		weeks: shown.filter((week) => week.isWorkingStudentWeek).map(weekView),
		findings: findings.map((finding) => redactStatutoryFinding(finding, input.audience)),
		lectureFreePeriods: periods.map((row) =>
			input.audience === "full"
				? { id: row.id, startsOn: row.startsOn, endsOn: row.endsOn, note: row.note }
				: { id: row.id, startsOn: row.startsOn, endsOn: row.endsOn },
		),
		priorWeeks,
	};
}

/** What an employee sees about themselves: the remaining 26-week balance and lecture-free periods. */
export interface OwnWorkingStudentStatus {
	readonly rolling: WorkingStudentRollingStatus;
	readonly lectureFreePeriods: readonly { readonly startsOn: string; readonly endsOn: string }[];
}

/**
 * The employee's own non-sensitive working-student status, or null when they are not a working
 * student this week. Pass the signed-in employee's own id; nothing about other employees, prior
 * employers, notes, acknowledgements or fingerprints is included.
 */
export async function loadOwnWorkingStudentStatus(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeId: string; readonly now: Instant },
): Promise<OwnWorkingStudentStatus | null> {
	const view = await loadWorkingStudentMonitor(db, { ...input, audience: "restricted" });
	if (!view.applies || !view.rolling) return null;
	return {
		rolling: view.rolling,
		lectureFreePeriods: view.lectureFreePeriods.map((period) => ({
			startsOn: period.startsOn,
			endsOn: period.endsOn,
		})),
	};
}

export interface WorkingStudentReviewItem {
	readonly employeeName: string;
	readonly finding: WorkingStudentFinding;
}

/**
 * Working-student findings for Settings → Contracts → Reviews & Conflicts (org admins): every
 * working student's weeks from 26 weeks ago to 8 weeks ahead, with acknowledgement states, the
 * most severe and most recent first.
 */
export async function listWorkingStudentReviewItems(
	db: Reader,
	input: { readonly organizationId: string; readonly now: Instant },
): Promise<WorkingStudentReviewItem[]> {
	const candidates = await loadWorkingStudentCandidates(db, {
		organizationId: input.organizationId,
		employeeIds: null,
	});
	if (candidates.length === 0) return [];
	const { timezone, monday } = await currentWeek(db, input.organizationId, input.now);
	const evaluations = await evaluateWorkingStudents(db, {
		organizationId: input.organizationId,
		timezone,
		window: {
			start: monday.subtract({ weeks: REVIEW_PAST_WEEKS }).toString(),
			endExclusive: monday.add({ weeks: REVIEW_FUTURE_WEEKS + 1 }).toString(),
		},
		employeeIds: candidates,
		now: input.now,
	});
	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		evaluations.flatMap((evaluation) => evaluation.findings),
	);
	if (findings.length === 0) return [];
	const people = await db
		.select({ id: employee.id, firstName: employee.firstName, lastName: employee.lastName })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, [...new Set(findings.map((finding) => finding.employeeId))]),
			),
		);
	const names = new Map(
		people.map((person) => [
			person.id,
			[person.firstName, person.lastName].filter(Boolean).join(" ").trim(),
		]),
	);
	const rank = { critical: 0, warning: 1, info: 2 } as const;
	return findings
		.map((finding) => ({ employeeName: names.get(finding.employeeId) ?? "", finding }))
		.sort(
			(a, b) =>
				rank[a.finding.severity] - rank[b.finding.severity] ||
				(a.finding.periodStart < b.finding.periodStart ? 1 : -1),
		);
}

export type WorkingStudentAcknowledgementRefusal =
	| "working_student_invalid_week"
	| "working_student_finding_not_found";

function refuse(refusal: WorkingStudentAcknowledgementRefusal, message: string, field: string) {
	return new ValidationError({ message, refusal, field });
}

/**
 * Records an org admin's reasoned acknowledgement of a working-student finding. The finding is
 * re-evaluated here, so the stored fingerprint is always the server's own.
 */
export async function acknowledgeWorkingStudentFinding(
	db: Pick<DatabaseClient, "select" | "insert">,
	input: {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly employeeId: string;
		readonly findingKind: WorkingStudentFindingKind;
		/** Monday of the compliance week the finding judges. */
		readonly weekStart: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		readonly now: Instant;
	},
): Promise<StatutoryAcknowledgementRecord> {
	if (!workingStudentFindingKinds.includes(input.findingKind)) {
		throw refuse("working_student_finding_not_found", "Unknown finding", "findingKind");
	}
	let monday: PlainDate;
	try {
		monday = parsePlainDate(input.weekStart);
	} catch {
		throw refuse("working_student_invalid_week", "Dates must use YYYY-MM-DD", "weekStart");
	}
	if (monday.dayOfWeek !== 1) {
		throw refuse("working_student_invalid_week", "A compliance week starts on Monday", "weekStart");
	}
	await loadEmployeeInOrganization(db, input);
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const [evaluation] = await evaluateWorkingStudents(db, {
		organizationId: input.organizationId,
		timezone,
		window: { start: monday.toString(), endExclusive: monday.add({ weeks: 1 }).toString() },
		employeeIds: [input.employeeId],
		now: input.now,
	});
	const finding = evaluation?.findings.find(
		(candidate) =>
			candidate.kind === input.findingKind && candidate.periodStart === input.weekStart,
	);
	const subject = finding ? statutoryAcknowledgementSubjectOf(finding) : null;
	if (!finding || !subject) {
		throw refuse(
			"working_student_finding_not_found",
			"This week no longer has the finding; reload the reviews",
			"weekStart",
		);
	}
	return recordStatutoryAcknowledgement(db, {
		...subject,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		inputFingerprint: finding.inputFingerprint,
		reason: input.reason,
		legalNote: input.legalNote,
		metadata: { severity: finding.severity, summary: finding.summary },
	});
}
