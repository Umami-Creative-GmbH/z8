import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { user } from "@/db/auth-schema";
import {
	employee,
	type ExternalLeaveNoticeDeliveryMethod,
	vacationExternalLeaveNotice,
	vacationLeaveOpportunityAssessment,
} from "@/db/schema";
import {
	calendarYearAt,
	dateFromInstant,
	instantFromDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import { type LeaveYearNoticeCoverage, leaveNoticeCoverage } from "./leave-notice-coverage";
import type { VacationBalance } from "./types";
import { loadVacationBalances } from "./vacation-balance-store";

export type LeaveNoticeRefusalCode =
	| "employee_not_found"
	| "notice_incomplete"
	| "delivered_in_future"
	| "deadline_not_after_delivery"
	| "leave_year_after_delivery"
	| "delivery_details_required"
	| "notice_not_found"
	| "basis_required"
	| "already_assessed";

/** An external leave notice or opportunity assessment HR cannot record as given. */
export class LeaveNoticeRefused extends Error {
	constructor(
		readonly code: LeaveNoticeRefusalCode,
		message: string,
	) {
		super(message);
	}
}

/** HR's documented opportunity to take the days a notice covers. */
export interface LeaveOpportunityAssessmentRecord {
	basis: string;
	assessedByName: string | null;
	assessedAt: Date;
}

/** A stored external leave notice with its opportunity assessment, if documented. */
export interface ExternalLeaveNoticeRecord {
	id: string;
	employeeId: string;
	leaveYear: number;
	days: number;
	deliveredOn: string;
	deliveryMethod: ExternalLeaveNoticeDeliveryMethod;
	deliveryDetails: string | null;
	/** Last valid instant of the stated deadline. */
	deadline: Date;
	/** The stated deadline as an organization-local date, valid through its end. */
	deadlineDate: string;
	timezone: string;
	requestedToTakeLeave: boolean;
	warnedOfLapse: boolean;
	supportingDocuments: string | null;
	attestedByName: string | null;
	attestedAt: Date;
	opportunity: LeaveOpportunityAssessmentRecord | null;
}

/** The last valid instant of an organization-local calendar date. */
function endOfLocalDate(date: Temporal.PlainDate, timezone: string): Date {
	return dateFromInstant(
		date.add({ days: 1 }).toZonedDateTime(timezone).toInstant().subtract({ milliseconds: 1 }),
	);
}

function trimmed(value: string | null | undefined): string | null {
	return value?.trim() || null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Records HR's dated attestation of a leave notice given outside Z8 to an employee of the
 * organization. The notice must have asked the employee to take the days and warned that unused
 * days could lapse; it was given by the organization-local date `deliveredOn`, no later than
 * today, for a leave year no later than that date's year, with a deadline after it.
 */
export async function recordExternalLeaveNotice(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		leaveYear: number;
		days: number;
		deliveredOn: string;
		deliveryMethod: ExternalLeaveNoticeDeliveryMethod;
		deliveryDetails: string | null;
		deadline: string;
		requestedToTakeLeave: boolean;
		warnedOfLapse: boolean;
		supportingDocuments: string | null;
		timezone: string;
		attestedBy: string;
		attestedAt: Date;
	},
): Promise<ExternalLeaveNoticeRecord> {
	if (!input.requestedToTakeLeave || !input.warnedOfLapse)
		throw new LeaveNoticeRefused(
			"notice_incomplete",
			"A leave notice must ask the employee to take the days and warn that unused days can lapse.",
		);
	const deliveryDetails = trimmed(input.deliveryDetails);
	if (input.deliveryMethod === "other" && !deliveryDetails)
		throw new LeaveNoticeRefused("delivery_details_required", "Describe how the notice was given.");
	const deliveredOn = Temporal.PlainDate.from(input.deliveredOn);
	const deadline = Temporal.PlainDate.from(input.deadline);
	const today = plainDateAt(instantFromDate(input.attestedAt), input.timezone);
	if (Temporal.PlainDate.compare(deliveredOn, today) > 0)
		throw new LeaveNoticeRefused(
			"delivered_in_future",
			"A notice can only be attested once it was given.",
		);
	if (Temporal.PlainDate.compare(deadline, deliveredOn) <= 0)
		throw new LeaveNoticeRefused(
			"deadline_not_after_delivery",
			"The deadline must be after the day the notice was given.",
		);
	if (input.leaveYear > deliveredOn.year)
		throw new LeaveNoticeRefused(
			"leave_year_after_delivery",
			"A notice can only cover leave of its delivery year or earlier.",
		);
	const [target] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		);
	if (!target) throw new LeaveNoticeRefused("employee_not_found", "Employee not found.");
	const [recorded] = await database
		.insert(vacationExternalLeaveNotice)
		.values({
			organizationId: input.organizationId,
			employeeId: target.id,
			leaveYear: input.leaveYear,
			days: String(round2(input.days)),
			deliveredOn: deliveredOn.toString(),
			deliveryMethod: input.deliveryMethod,
			deliveryDetails,
			deadline: endOfLocalDate(deadline, input.timezone),
			timezone: input.timezone,
			requestedToTakeLeave: true,
			warnedOfLapse: true,
			supportingDocuments: trimmed(input.supportingDocuments),
			attestedBy: input.attestedBy,
			attestedAt: input.attestedAt,
		})
		.returning({ id: vacationExternalLeaveNotice.id });
	const notices = await loadExternalLeaveNotices(database, {
		organizationId: input.organizationId,
		employeeIds: [target.id],
	});
	return notices
		.get(target.id)
		?.find((notice) => notice.id === recorded.id) as ExternalLeaveNoticeRecord;
}

/**
 * Records HR's finding, with its basis, that the employee had a real opportunity to take the days
 * an external leave notice of the organization covers by its deadline. Once per notice.
 */
export async function documentLeaveOpportunity(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		noticeId: string;
		basis: string;
		assessedBy: string;
		assessedAt: Date;
	},
): Promise<{ noticeId: string; employeeId: string; basis: string; assessedAt: Date }> {
	const basis = input.basis.trim();
	if (!basis)
		throw new LeaveNoticeRefused(
			"basis_required",
			"Record why the employee could take the covered days by the deadline.",
		);
	const [notice] = await database
		.select({
			id: vacationExternalLeaveNotice.id,
			employeeId: vacationExternalLeaveNotice.employeeId,
		})
		.from(vacationExternalLeaveNotice)
		.where(
			and(
				eq(vacationExternalLeaveNotice.id, input.noticeId),
				eq(vacationExternalLeaveNotice.organizationId, input.organizationId),
			),
		);
	if (!notice) throw new LeaveNoticeRefused("notice_not_found", "Leave notice not found.");
	const [assessed] = await database
		.insert(vacationLeaveOpportunityAssessment)
		.values({
			organizationId: input.organizationId,
			externalNoticeId: notice.id,
			basis,
			assessedBy: input.assessedBy,
			assessedAt: input.assessedAt,
		})
		.onConflictDoNothing({ target: vacationLeaveOpportunityAssessment.externalNoticeId })
		.returning();
	if (!assessed)
		throw new LeaveNoticeRefused(
			"already_assessed",
			"The opportunity to take this notice's days is already documented.",
		);
	return {
		noticeId: notice.id,
		employeeId: notice.employeeId,
		basis: assessed.basis,
		assessedAt: assessed.assessedAt,
	};
}

/** Each employee's external leave notices with their assessments, oldest delivery first. */
export async function loadExternalLeaveNotices(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, ExternalLeaveNoticeRecord[]>> {
	if (!input.employeeIds.length) return new Map();
	const notices = await database
		.select({ notice: vacationExternalLeaveNotice, attestedByName: user.name })
		.from(vacationExternalLeaveNotice)
		.leftJoin(user, eq(user.id, vacationExternalLeaveNotice.attestedBy))
		.where(
			and(
				eq(vacationExternalLeaveNotice.organizationId, input.organizationId),
				inArray(vacationExternalLeaveNotice.employeeId, [...input.employeeIds]),
			),
		)
		.orderBy(
			asc(vacationExternalLeaveNotice.deliveredOn),
			asc(vacationExternalLeaveNotice.attestedAt),
		);
	if (!notices.length) return new Map();
	const assessments = await database
		.select({ assessment: vacationLeaveOpportunityAssessment, assessedByName: user.name })
		.from(vacationLeaveOpportunityAssessment)
		.leftJoin(user, eq(user.id, vacationLeaveOpportunityAssessment.assessedBy))
		.where(
			and(
				eq(vacationLeaveOpportunityAssessment.organizationId, input.organizationId),
				inArray(
					vacationLeaveOpportunityAssessment.externalNoticeId,
					notices.map((row) => row.notice.id),
				),
			),
		);
	const byNotice = new Map(
		assessments.map((row) => [
			row.assessment.externalNoticeId,
			{
				basis: row.assessment.basis,
				assessedByName: row.assessedByName,
				assessedAt: row.assessment.assessedAt,
			},
		]),
	);
	const result = new Map<string, ExternalLeaveNoticeRecord[]>();
	for (const { notice, attestedByName } of notices) {
		const record: ExternalLeaveNoticeRecord = {
			id: notice.id,
			employeeId: notice.employeeId,
			leaveYear: notice.leaveYear,
			days: Number(notice.days),
			deliveredOn: notice.deliveredOn,
			deliveryMethod: notice.deliveryMethod,
			deliveryDetails: notice.deliveryDetails,
			deadline: notice.deadline,
			deadlineDate: plainDateAt(instantFromDate(notice.deadline), notice.timezone).toString(),
			timezone: notice.timezone,
			requestedToTakeLeave: notice.requestedToTakeLeave,
			warnedOfLapse: notice.warnedOfLapse,
			supportingDocuments: notice.supportingDocuments,
			attestedByName,
			attestedAt: notice.attestedAt,
			opportunity: byNotice.get(notice.id) ?? null,
		};
		result.set(notice.employeeId, [...(result.get(notice.employeeId) ?? []), record]);
	}
	return result;
}

/**
 * The days still outstanding per leave year in a vacation balance: each carried earning year's
 * unexpired remainder, and the vacation year's own remainder.
 */
export function outstandingDaysByLeaveYear(balance: VacationBalance): Map<number, number> {
	const outstanding = new Map<number, number>();
	let carried = 0;
	for (const row of balance.earningYears ?? []) {
		const days = row.expired ? 0 : row.remainingDays;
		carried += days;
		outstanding.set(row.earningYear, round2((outstanding.get(row.earningYear) ?? 0) + days));
	}
	outstanding.set(
		balance.year,
		round2((outstanding.get(balance.year) ?? 0) + Math.max(0, balance.remainingDays - carried)),
	);
	return outstanding;
}

/**
 * An employee's external leave notices and, when their vacation balance is known, which of the
 * outstanding days of each leave year the notices cover in the organization-local current year.
 */
export async function loadEmployeeLeaveNotices(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; timezone: string; currentDate: Date },
): Promise<{
	year: number;
	timezone: string;
	notices: ExternalLeaveNoticeRecord[];
	coverage: LeaveYearNoticeCoverage[] | null;
}> {
	const year = calendarYearAt(instantFromDate(input.currentDate), input.timezone);
	const notices =
		(
			await loadExternalLeaveNotices(database, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
			})
		).get(input.employeeId) ?? [];
	const { balances } = await loadVacationBalances(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year,
		timezone: input.timezone,
		currentDate: input.currentDate,
	});
	const balance = balances.get(input.employeeId);
	return {
		year,
		timezone: input.timezone,
		notices,
		coverage: balance
			? leaveNoticeCoverage(
					outstandingDaysByLeaveYear(balance),
					notices.map((notice) => ({
						id: notice.id,
						leaveYear: notice.leaveYear,
						days: notice.days,
						deliveredOn: notice.deliveredOn,
						deadline: instantFromDate(notice.deadline),
						opportunityDocumented: notice.opportunity !== null,
					})),
				)
			: null,
	};
}
