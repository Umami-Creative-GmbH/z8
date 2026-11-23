/**
 * Read models for the § 12 TzBfG on-call surfaces (#1992): the org-admin Reviews & Conflicts list,
 * the per-employee status (Employee Detail, the employee's own profile, Absences) and the payroll
 * preparation list. Everything here is minutes and days only; findings are redacted for the
 * restricted audience before they leave the server.
 */
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, employeeEmploymentHistory } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
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
import { ON_CALL_PAYROLL_MAX_MONTHS, onCallPayrollRangeTooLong } from "./payroll-range";
import {
	earliestSickStarts,
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
	// The display name derives from the user, not the deprecated employee name columns.
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
 * The employee's own view (unless they are an org admin) judges published shifts only: employees
 * never see draft shifts, so a draft call must not show up as a finding or as band minutes.
 */
export async function loadOnCallEmployeeStatus(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly timezone: string;
		readonly now: Instant;
		readonly audience: StatutoryAudience;
		/** Whether the viewer is the employee themself. */
		readonly selfView: boolean;
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
			publishedShiftsOnly: input.selfView && input.audience === "restricted",
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
		/** The reader's payroll scope; null or left out: every employee of the organization. */
		readonly employeeIds?: readonly string[] | null;
	},
): Promise<OnCallPayrollReferenceRow[]> {
	const start = parsePlainDate(input.startDate);
	const end = parsePlainDate(input.endDate);
	if (onCallPayrollRangeTooLong(input.startDate, input.endDate)) {
		throw new ValidationError({
			message: `List on-call reference hours for at most ${ON_CALL_PAYROLL_MAX_MONTHS} months at a time`,
			field: "endDate",
			refusal: "on_call_payroll_range_too_long" satisfies OnCallPayrollRefusal,
		});
	}
	if (comparePlainDates(end, start) < 0) return [];
	if (input.employeeIds?.length === 0) return [];
	const until = end.add({ days: 1 }).toString();

	// Confirmed on-call terms starting before the period ends. Their end is checked below, against
	// each employee's own first event, so only these employees' sick leave is walked back.
	const terms = await db
		.select({
			employeeId: employeeEmploymentHistory.employeeId,
			validUntilDate: employeeEmploymentHistory.validUntilDate,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.scheduleSource, "on_call"),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(employeeEmploymentHistory.validFromDate, until),
				input.employeeIds
					? inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds])
					: undefined,
			),
		);
	if (terms.length === 0) return [];
	// An illness running into the period is dated from its own (first leave's) start: terms must
	// cover that day.
	const firstEventOf = await earliestSickStarts(db, {
		organizationId: input.organizationId,
		employeeIds: [...new Set(terms.map((row) => row.employeeId))],
		from: input.startDate,
		// Leave starting on the first day may continue an illness from before the period.
		untilExclusive: start.add({ days: 1 }).toString(),
	});
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
