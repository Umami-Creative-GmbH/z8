/**
 * Per-employee statutory context (#1988): external / prior-employment offsets, working-student
 * lecture-free periods and apprentice school / exam releases. Org-admin data: callers authorize
 * (`organizationAction` with `requires: "orgAdmin"`) before writing, and never hand offsets with
 * money to scoped managers (see `redaction.ts`). Rows are never edited: void and record again.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
	type ApprenticeReleaseKind,
	type EmployeeApprenticeRelease,
	type EmployeeStatutoryOffset,
	type EmployeeStatutoryOffsetKind,
	type EmployeeStudyPeriod,
	employeeApprenticeRelease,
	employeeStatutoryOffset,
	employeeStudyPeriod,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadEmployeeInOrganization } from "./employee-scope";

type Reader = Pick<DatabaseClient, "select">;
type Writer = Pick<DatabaseClient, "select" | "insert" | "update">;

export type EmployeeContextRefusal =
	| "statutory_period_overlap"
	| "statutory_invalid_range"
	| "statutory_invalid_value"
	| "statutory_note_required"
	| "statutory_release_single_day";

interface Scope {
	readonly organizationId: string;
	readonly employeeId: string;
}

interface WriteScope extends Scope {
	readonly actorUserId: string;
}

function refuse(refusal: EmployeeContextRefusal, message: string, field?: string): never {
	throw new ValidationError({ message, refusal, field });
}

function checkRange(from: string, until: string | null, inclusive: boolean): void {
	try {
		const start = parsePlainDate(from);
		if (until === null) return;
		const order = comparePlainDates(start, parsePlainDate(until));
		if (inclusive ? order > 0 : order >= 0) {
			refuse("statutory_invalid_range", "The end date must not be before the start date");
		}
	} catch (error) {
		if (error instanceof ValidationError) throw error;
		refuse("statutory_invalid_range", "Dates must use YYYY-MM-DD");
	}
}

/** A compliance week starts on Monday. */
function parseWeekStart(value: string): PlainDate {
	let day: PlainDate;
	try {
		day = parsePlainDate(value);
	} catch {
		refuse("statutory_invalid_range", "Dates must use YYYY-MM-DD", "firstWeekStartsOn");
	}
	if (day.dayOfWeek !== 1) {
		refuse("statutory_invalid_range", "A week starts on Monday", "firstWeekStartsOn");
	}
	return day;
}

function checkCount(value: number, max: number): void {
	if (!Number.isInteger(value) || value < 0 || value > max) {
		refuse("statutory_invalid_value", `The value must be a whole number from 0 to ${max}`, "count");
	}
}

function isExclusionViolation(error: unknown): boolean {
	for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
		if ((current as { code?: unknown }).code === "23P01") return true;
		if (typeof current !== "object") break;
	}
	return false;
}

async function insertWithoutOverlap<T>(insert: () => Promise<T>): Promise<T> {
	try {
		return await insert();
	} catch (error) {
		if (isExclusionViolation(error)) {
			refuse("statutory_period_overlap", "The period overlaps an existing period");
		}
		throw error;
	}
}

// ─── External / prior-employment offsets ────────────────────────────────────────────────────────

export type RecordEmployeeStatutoryOffsetInput = WriteScope & {
	readonly note: string;
	readonly sourceEmployer?: string | null;
} & (
		| {
				/**
				 * External Minijob earnings for every calendar month in `[validFromDate, validUntilDate)`.
				 * Both dates are the first of a month, so a month counts in full or not at all.
				 */
				readonly offsetKind: "external_minijob_monthly_earnings";
				readonly validFromDate: string;
				readonly validUntilDate: string | null;
				readonly amountCents: number;
				readonly currency?: string;
		  }
		| {
				/** Prior short-term work days or months at other employers in one calendar year. */
				readonly offsetKind: "prior_short_term_work_days" | "prior_short_term_months";
				readonly calendarYear: number;
				readonly count: number;
		  }
		| {
				/**
				 * `count` consecutive Monday–Sunday prior-employer weeks above 20 h, the first starting on
				 * the Monday `firstWeekStartsOn`. Stored as `[start, start + 7 × count)`, so a rolling
				 * 12-month window can age each week out exactly; record separate runs as separate rows.
				 */
				readonly offsetKind: "prior_working_student_over_20h_weeks";
				readonly firstWeekStartsOn: string;
				readonly count: number;
		  }
	);

export async function recordEmployeeStatutoryOffset(
	db: Writer,
	input: RecordEmployeeStatutoryOffsetInput,
): Promise<EmployeeStatutoryOffset> {
	const note = input.note.trim();
	if (!note) refuse("statutory_note_required", "Record where the offset comes from", "note");

	let values: Pick<
		typeof employeeStatutoryOffset.$inferInsert,
		"validFromDate" | "validUntilDate" | "amountCents" | "currency" | "countValue"
	>;
	switch (input.offsetKind) {
		case "external_minijob_monthly_earnings":
			checkRange(input.validFromDate, input.validUntilDate, false);
			for (const [field, value] of [
				["validFromDate", input.validFromDate],
				["validUntilDate", input.validUntilDate],
			] as const) {
				if (value !== null && parsePlainDate(value).day !== 1) {
					refuse("statutory_invalid_range", "Monthly earnings start and end on the 1st", field);
				}
			}
			if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
				refuse("statutory_invalid_value", "Earnings must be a non-negative amount", "amountCents");
			}
			values = {
				validFromDate: input.validFromDate,
				validUntilDate: input.validUntilDate,
				amountCents: input.amountCents,
				currency: input.currency ?? "EUR",
				countValue: null,
			};
			break;
		case "prior_short_term_work_days":
		case "prior_short_term_months":
			if (!Number.isInteger(input.calendarYear) || input.calendarYear < 2000) {
				refuse("statutory_invalid_value", "Enter a calendar year", "calendarYear");
			}
			checkCount(input.count, input.offsetKind === "prior_short_term_months" ? 12 : 366);
			values = {
				validFromDate: `${input.calendarYear}-01-01`,
				validUntilDate: `${input.calendarYear + 1}-01-01`,
				amountCents: null,
				currency: null,
				countValue: input.count,
			};
			break;
		case "prior_working_student_over_20h_weeks": {
			checkCount(input.count, 53);
			if (input.count < 1) {
				refuse("statutory_invalid_value", "Record at least one week", "count");
			}
			const firstMonday = parseWeekStart(input.firstWeekStartsOn);
			values = {
				validFromDate: firstMonday.toString(),
				validUntilDate: firstMonday.add({ days: 7 * input.count }).toString(),
				amountCents: null,
				currency: null,
				countValue: input.count,
			};
			break;
		}
	}

	await loadEmployeeInOrganization(db, input);
	const [row] = await db
		.insert(employeeStatutoryOffset)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			offsetKind: input.offsetKind,
			...values,
			sourceEmployer: input.sourceEmployer?.trim() || null,
			note,
			createdBy: input.actorUserId,
		})
		.returning();
	return row;
}

/** Active (not voided) offsets overlapping `[from, until)`, oldest first. */
export async function listEmployeeStatutoryOffsets(
	db: Reader,
	input: Scope & {
		readonly kinds?: readonly EmployeeStatutoryOffsetKind[];
		readonly from?: string;
		readonly until?: string;
	},
): Promise<EmployeeStatutoryOffset[]> {
	const conditions = [
		eq(employeeStatutoryOffset.organizationId, input.organizationId),
		eq(employeeStatutoryOffset.employeeId, input.employeeId),
		isNull(employeeStatutoryOffset.voidedAt),
	];
	if (input.kinds) conditions.push(inArray(employeeStatutoryOffset.offsetKind, [...input.kinds]));
	if (input.until) conditions.push(lt(employeeStatutoryOffset.validFromDate, input.until));
	if (input.from) {
		const overlapsFrom = or(
			isNull(employeeStatutoryOffset.validUntilDate),
			gt(employeeStatutoryOffset.validUntilDate, input.from),
		);
		if (overlapsFrom) conditions.push(overlapsFrom);
	}
	return db
		.select()
		.from(employeeStatutoryOffset)
		.where(and(...conditions))
		.orderBy(asc(employeeStatutoryOffset.validFromDate), asc(employeeStatutoryOffset.createdAt));
}

async function voidRow(
	db: Writer,
	table:
		| typeof employeeStatutoryOffset
		| typeof employeeStudyPeriod
		| typeof employeeApprenticeRelease,
	input: WriteScope & { readonly id: string; readonly reason: string },
): Promise<void> {
	// A voided record stops counting toward a statutory limit, so the audit trail must say why.
	const reason = input.reason.trim();
	if (!reason) refuse("statutory_note_required", "Record why this entry is voided", "reason");
	const rows = await db
		.update(table)
		.set({
			voidedAt: currentTimestamp(),
			voidedBy: input.actorUserId,
			voidReason: reason,
		})
		.where(
			and(
				eq(table.id, input.id),
				eq(table.organizationId, input.organizationId),
				eq(table.employeeId, input.employeeId),
				isNull(table.voidedAt),
			),
		)
		.returning({ id: table.id });
	if (rows.length === 0) {
		throw new NotFoundError({
			message: "Record not found",
			entityType: "statutory_context",
			entityId: input.id,
		});
	}
}

export function voidEmployeeStatutoryOffset(
	db: Writer,
	input: WriteScope & { readonly offsetId: string; readonly reason: string },
): Promise<void> {
	return voidRow(db, employeeStatutoryOffset, { ...input, id: input.offsetId });
}

// ─── Working-student lecture-free periods ──────────────────────────────────────────────────────

export async function recordEmployeeStudyPeriod(
	db: Writer,
	input: WriteScope & {
		/** First and last lecture-free day (both inclusive). */
		readonly startsOn: string;
		readonly endsOn: string;
		readonly note?: string | null;
	},
): Promise<EmployeeStudyPeriod> {
	checkRange(input.startsOn, input.endsOn, true);
	await loadEmployeeInOrganization(db, input);
	const [row] = await insertWithoutOverlap(() =>
		db
			.insert(employeeStudyPeriod)
			.values({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				periodKind: "lecture_free",
				startsOn: input.startsOn,
				endsOn: input.endsOn,
				note: input.note?.trim() || null,
				createdBy: input.actorUserId,
			})
			.returning(),
	);
	return row;
}

/** Active lecture-free periods touching `[from, until)` (all when no range), oldest first. */
export async function listEmployeeStudyPeriods(
	db: Reader,
	input: Scope & { readonly from?: string; readonly until?: string },
): Promise<EmployeeStudyPeriod[]> {
	const conditions = [
		eq(employeeStudyPeriod.organizationId, input.organizationId),
		eq(employeeStudyPeriod.employeeId, input.employeeId),
		isNull(employeeStudyPeriod.voidedAt),
	];
	if (input.until) conditions.push(lt(employeeStudyPeriod.startsOn, input.until));
	if (input.from) conditions.push(gte(employeeStudyPeriod.endsOn, input.from));
	return db
		.select()
		.from(employeeStudyPeriod)
		.where(and(...conditions))
		.orderBy(asc(employeeStudyPeriod.startsOn));
}

export function voidEmployeeStudyPeriod(
	db: Writer,
	input: WriteScope & { readonly periodId: string; readonly reason: string },
): Promise<void> {
	return voidRow(db, employeeStudyPeriod, { ...input, id: input.periodId });
}

// ─── Apprentice vocational-school and exam releases ────────────────────────────────────────────

export async function recordApprenticeRelease(
	db: Writer,
	input: WriteScope & {
		readonly releaseKind: ApprenticeReleaseKind;
		/** First and last release day (both inclusive); only block weeks span several days. */
		readonly startsOn: string;
		readonly endsOn: string;
		readonly lessonCount?: number | null;
		readonly schoolMinutes?: number | null;
		readonly note?: string | null;
	},
): Promise<EmployeeApprenticeRelease> {
	checkRange(input.startsOn, input.endsOn, true);
	if (input.releaseKind !== "vocational_school_block_week" && input.startsOn !== input.endsOn) {
		refuse("statutory_release_single_day", "This release covers a single day");
	}
	if (input.lessonCount != null) checkCount(input.lessonCount, 20);
	if (input.schoolMinutes != null) checkCount(input.schoolMinutes, 10_080);
	await loadEmployeeInOrganization(db, input);
	const [row] = await insertWithoutOverlap(() =>
		db
			.insert(employeeApprenticeRelease)
			.values({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				releaseKind: input.releaseKind,
				startsOn: input.startsOn,
				endsOn: input.endsOn,
				lessonCount: input.lessonCount ?? null,
				schoolMinutes: input.schoolMinutes ?? null,
				note: input.note?.trim() || null,
				createdBy: input.actorUserId,
			})
			.returning(),
	);
	return row;
}

/** Active releases touching `[from, until)` (all when no range), oldest first. */
export async function listApprenticeReleases(
	db: Reader,
	input: Scope & { readonly from?: string; readonly until?: string },
): Promise<EmployeeApprenticeRelease[]> {
	const conditions = [
		eq(employeeApprenticeRelease.organizationId, input.organizationId),
		eq(employeeApprenticeRelease.employeeId, input.employeeId),
		isNull(employeeApprenticeRelease.voidedAt),
	];
	if (input.until) conditions.push(lt(employeeApprenticeRelease.startsOn, input.until));
	if (input.from) conditions.push(gte(employeeApprenticeRelease.endsOn, input.from));
	return db
		.select()
		.from(employeeApprenticeRelease)
		.where(and(...conditions))
		.orderBy(asc(employeeApprenticeRelease.startsOn));
}

export function voidApprenticeRelease(
	db: Writer,
	input: WriteScope & { readonly releaseId: string; readonly reason: string },
): Promise<void> {
	return voidRow(db, employeeApprenticeRelease, { ...input, id: input.releaseId });
}
