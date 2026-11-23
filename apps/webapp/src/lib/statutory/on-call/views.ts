/**
 * Read models for the § 12 TzBfG on-call surfaces (#1992): the org-admin Reviews & Conflicts list,
 * the per-employee status (Employee Detail, the employee's own profile, Absences) and the payroll
 * preparation list. Everything here is minutes and days only; findings are redacted for the
 * restricted audience before they leave the server.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, min, or } from "drizzle-orm";
import { absenceCategory, absenceEntry, employee, employeeEmploymentHistory } from "@/db/schema";
import { resolveEffectiveContractOnDay } from "@/lib/contracts/resolve-contract";
import {
	comparePlainDates,
	type Instant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { attachAcknowledgementStates } from "../acknowledgements";
import { loadEmployeeInOrganization } from "../employee-scope";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import {
	type RedactedStatutoryFinding,
	redactStatutoryFindings,
	type StatutoryAudience,
} from "../redaction";
import { evaluateOnCallFindings, type OnCallFinding, type OnCallFindingKind } from "./monitor";
import {
	listOnCallReferenceEvents,
	listOnCallReferenceEventsBatch,
	type OnCallReferenceEvent,
	type OnCallReferenceMethod,
} from "./reference-period";

type Reader = Pick<DatabaseClient, "select" | "query">;

/** Days before and after today the review and status surfaces judge. */
export const ON_CALL_REVIEW_LOOKBACK_DAYS = 28;
export const ON_CALL_REVIEW_LOOKAHEAD_DAYS = 28;
/** Sick leave and holidays listed on the status card: the last ~3 months up to today. */
export const ON_CALL_EVENT_LOOKBACK_DAYS = 92;

export interface OnCallTermsView {
	readonly hoursKind: "exact" | "minimum" | "maximum" | "unspecified";
	readonly weeklyMinutes: number | null;
	readonly dailyMinutes: number | null;
}

export type OnCallFindingView = OnCallFinding | RedactedStatutoryFinding<OnCallFindingKind>;

export interface OnCallReviewItem {
	readonly employeeId: string;
	readonly employeeName: string;
	readonly finding: OnCallFinding;
}

async function employeeNames(
	db: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await db
		.select({ id: employee.id, firstName: employee.firstName, lastName: employee.lastName })
		.from(employee)
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	return new Map(
		rows.map((row) => [row.id, [row.firstName, row.lastName].filter(Boolean).join(" ") || row.id]),
	);
}

function reviewWindow(now: Instant, timezone: string) {
	const today = plainDateAt(now, timezone);
	return {
		start: today.subtract({ days: ON_CALL_REVIEW_LOOKBACK_DAYS }).toString(),
		endExclusive: today.add({ days: ON_CALL_REVIEW_LOOKAHEAD_DAYS + 1 }).toString(),
	};
}

/**
 * Open on-call findings of the organization for Settings → Contracts → Reviews & Conflicts (org
 * admins: full detail). Informational under-band weeks still running are left out; short-notice
 * findings carry their acknowledgement state.
 */
export async function listOnCallReviewItems(
	db: Reader,
	input: { readonly organizationId: string; readonly timezone: string; readonly now: Instant },
): Promise<OnCallReviewItem[]> {
	const preferences = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		(
			await evaluateOnCallFindings(db, {
				organizationId: input.organizationId,
				timezone: input.timezone,
				window: reviewWindow(input.now, input.timezone),
				preferences,
				now: input.now,
			})
		).filter((finding) => finding.severity !== "info"),
	);
	const names = await employeeNames(db, input.organizationId, [
		...new Set(findings.map((finding) => finding.employeeId)),
	]);
	return findings
		.map((finding) => ({
			employeeId: finding.employeeId,
			employeeName: names.get(finding.employeeId) ?? finding.employeeId,
			finding,
		}))
		.toSorted(
			(a, b) =>
				a.finding.periodStart.localeCompare(b.finding.periodStart) ||
				a.employeeName.localeCompare(b.employeeName) ||
				a.finding.id.localeCompare(b.finding.id),
		);
}

export interface OnCallEmployeeStatus {
	readonly audience: StatutoryAudience;
	/** Today's on-call terms, or null when the employee is not on call today. */
	readonly terms: OnCallTermsView | null;
	/** Whether the employee has confirmed on-call terms at all (past, present or future). */
	readonly hasOnCallTerms: boolean;
	readonly findings: readonly OnCallFindingView[];
	readonly referenceEvents: readonly OnCallReferenceEvent[];
	readonly method: OnCallReferenceMethod;
}

/**
 * One employee's on-call status for Employee Detail, the employee's own profile and Absences.
 * The caller authorizes (org admin, a manager whose scope reaches the employee, or the employee).
 */
export async function loadOnCallEmployeeStatus(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly audience: StatutoryAudience;
		readonly method: OnCallReferenceMethod;
	},
): Promise<OnCallEmployeeStatus> {
	await loadEmployeeInOrganization(db, input);
	const [anyTerms] = await db
		.select({ id: employeeEmploymentHistory.id })
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.employeeId, input.employeeId),
				eq(employeeEmploymentHistory.scheduleSource, "on_call"),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		)
		.orderBy(asc(employeeEmploymentHistory.validFromDate))
		.limit(1);
	const empty: OnCallEmployeeStatus = {
		audience: input.audience,
		terms: null,
		hasOnCallTerms: false,
		findings: [],
		referenceEvents: [],
		method: input.method,
	};
	if (!anyTerms) return empty;

	const today = plainDateAt(input.now, input.timezone);
	const contract = await resolveEffectiveContractOnDay(db, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		date: today,
		timezoneOverride: input.timezone,
	});
	// Terms that outlive the employment are no on-call status: as the monitor, require employment.
	const terms =
		contract?.isEmployedOnDay && contract.onCallTerms
			? {
					hoursKind: contract.onCallTerms.hoursKind,
					weeklyMinutes: contract.onCallTerms.weeklyMinutes,
					dailyMinutes: contract.onCallTerms.dailyMinutes,
				}
			: null;
	const preferences = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		await evaluateOnCallFindings(db, {
			organizationId: input.organizationId,
			timezone: input.timezone,
			window: reviewWindow(input.now, input.timezone),
			employeeIds: [input.employeeId],
			preferences,
			now: input.now,
		}),
	);
	const referenceEvents = await listOnCallReferenceEvents(db, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		from: today.subtract({ days: ON_CALL_EVENT_LOOKBACK_DAYS }).toString(),
		untilExclusive: today.add({ days: 1 }).toString(),
		method: input.method,
	});
	return {
		audience: input.audience,
		terms,
		hasOnCallTerms: true,
		findings: redactStatutoryFindings(findings, input.audience),
		referenceEvents,
		method: input.method,
	};
}

export interface OnCallPayrollReferenceRow extends OnCallReferenceEvent {
	readonly employeeId: string;
	readonly employeeName: string;
}

export type OnCallPayrollRefusal = "on_call_payroll_range_too_long";

/** The longest payroll range listed at once: a payroll period, never a year of history. */
export const ON_CALL_PAYROLL_MAX_MONTHS = 3;

/**
 * Sick-leave starts and public holidays of every on-call employee in a payroll period, each with
 * its reference hours, for Payroll Export / comparison preparation. Reads only: settled days and
 * closed months are never touched. Only employees with on-call terms overlapping the period (or
 * the sick leave running into it) are read, in one batch; ranges longer than
 * {@link ON_CALL_PAYROLL_MAX_MONTHS} months are refused.
 */
export async function listOnCallPayrollReferenceRows(
	db: Reader,
	input: {
		readonly organizationId: string;
		/** Inclusive payroll period, `YYYY-MM-DD`. */
		readonly startDate: string;
		readonly endDate: string;
		readonly method: OnCallReferenceMethod;
	},
): Promise<OnCallPayrollReferenceRow[]> {
	const start = parsePlainDate(input.startDate);
	const end = parsePlainDate(input.endDate);
	if (comparePlainDates(end, start.add({ months: ON_CALL_PAYROLL_MAX_MONTHS })) >= 0) {
		throw new ValidationError({
			message: `List on-call reference hours for at most ${ON_CALL_PAYROLL_MAX_MONTHS} months at a time`,
			field: "endDate",
			refusal: "on_call_payroll_range_too_long" satisfies OnCallPayrollRefusal,
		});
	}
	if (comparePlainDates(end, start) < 0) return [];
	const until = end.add({ days: 1 }).toString();

	// Sick leave running into the period is dated from its own start: terms must cover that day.
	const sickSince = await db
		.select({ employeeId: absenceEntry.employeeId, startDate: min(absenceEntry.startDate) })
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.type, "sick"),
				eq(absenceCategory.requiresWorkTime, false),
				lt(absenceEntry.startDate, input.startDate),
				gte(absenceEntry.endDate, input.startDate),
			),
		)
		.groupBy(absenceEntry.employeeId);
	const firstEventOf = new Map(
		sickSince.flatMap((row) => (row.startDate ? [[row.employeeId, row.startDate] as const] : [])),
	);
	const earliest = [...firstEventOf.values()].reduce((a, b) => (a < b ? a : b), input.startDate);
	const terms = await db
		.select({
			employeeId: employeeEmploymentHistory.employeeId,
			validFromDate: employeeEmploymentHistory.validFromDate,
			validUntilDate: employeeEmploymentHistory.validUntilDate,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.scheduleSource, "on_call"),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(employeeEmploymentHistory.validFromDate, until),
				or(
					isNull(employeeEmploymentHistory.validUntilDate),
					gt(employeeEmploymentHistory.validUntilDate, earliest),
				),
			),
		);
	const employeeIds = [
		...new Set(
			terms
				.filter((row) => {
					const from = firstEventOf.get(row.employeeId) ?? input.startDate;
					return row.validUntilDate === null || row.validUntilDate > from;
				})
				.map((row) => row.employeeId),
		),
	].toSorted();
	if (employeeIds.length === 0) return [];

	const names = await employeeNames(db, input.organizationId, employeeIds);
	const events = await listOnCallReferenceEventsBatch(db, {
		organizationId: input.organizationId,
		employeeIds,
		from: input.startDate,
		untilExclusive: until,
		method: input.method,
	});
	return [...events]
		.flatMap(([employeeId, list]) =>
			list.map((event) => ({
				...event,
				employeeId,
				employeeName: names.get(employeeId) ?? employeeId,
			})),
		)
		.toSorted(
			(a, b) =>
				a.eventDate.localeCompare(b.eventDate) || a.employeeName.localeCompare(b.employeeName),
		);
}
