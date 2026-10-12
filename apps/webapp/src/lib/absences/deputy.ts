/**
 * Deputy rules of an absence (#802, #1011). A deputy is the colleague an
 * employee names on an absence to cover for them; naming one needs no
 * acceptance and is not part of what the absence's approver approves.
 */

import { canAccessApprovalInbox, defineAbilityFor } from "@/lib/authorization/ability";
import type { PrincipalContext } from "@/lib/authorization/types";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EmployeeRole } from "@/lib/validations/employee";

/** Why a deputy cannot be named (or left out) on an absence. */
export type DeputyRefusal =
	/** The absence's category requires a deputy. */
	| "deputy_required"
	/** The absent employee cannot cover for themselves. */
	| "deputy_is_absent_employee"
	/** Not an active employee of the absence's organization. */
	| "deputy_unavailable";

/** Server messages of each refusal; the forms show them on the deputy field. */
export const DEPUTY_REFUSAL_MESSAGES: Readonly<Record<DeputyRefusal, string>> = {
	deputy_required: "Choose a deputy: this absence type requires one.",
	deputy_is_absent_employee: "An employee cannot be their own deputy.",
	deputy_unavailable: "The deputy must be an active employee of this organization.",
};

/**
 * Whether a category type may require a deputy (#1011): any but sick leave,
 * where nobody plans the absence ahead.
 */
export function canRequireDeputy(categoryType: string): boolean {
	return categoryType !== "sick";
}

/** The named deputy as loaded by id; null when no employee has that id. */
export interface DeputyCandidateFacts {
	id: string;
	organizationId: string;
	isActive: boolean;
}

/**
 * Whether an absence may name this deputy, or no deputy at all. The caller
 * loads the deputy by `deputyEmployeeId`; any active employee of the absence's
 * organization except the absent employee qualifies.
 */
export function checkDeputyForAbsence(input: {
	organizationId: string;
	absentEmployeeId: string;
	deputyEmployeeId: string | null | undefined;
	deputy: DeputyCandidateFacts | null;
	deputyRequired: boolean;
}): DeputyRefusal | null {
	if (!input.deputyEmployeeId) {
		return input.deputyRequired ? "deputy_required" : null;
	}
	if (input.deputyEmployeeId === input.absentEmployeeId) {
		return "deputy_is_absent_employee";
	}
	const { deputy } = input;
	if (
		!deputy ||
		deputy.id !== input.deputyEmployeeId ||
		deputy.organizationId !== input.organizationId ||
		!deputy.isActive
	) {
		return "deputy_unavailable";
	}
	return null;
}

/** Whether an actor may change the deputy of an existing absence right now. */
export type DeputyChangeAccess = "allowed" | "forbidden" | "absence_closed";

/**
 * The absent employee, their eligible managers and admins change an absence's
 * deputy; nobody else. Pending and approved absences can change it until the
 * absence has ended (it still can on its last day). `today` is the absent
 * employee's plain date, in their timezone (`absentEmployeeTimezone`).
 */
export function checkDeputyChangeAccess(input: {
	actor: {
		employeeId: string;
		role: EmployeeRole;
		/** The actor is an eligible manager of the absent employee. */
		managesAbsentEmployee: boolean;
	};
	absence: {
		employeeId: string;
		status: "pending" | "approved" | "rejected";
		endDate: string;
	};
	today: string;
}): DeputyChangeAccess {
	const { actor, absence } = input;
	const mayChange =
		actor.employeeId === absence.employeeId ||
		actor.role === "admin" ||
		(actor.role === "manager" && actor.managesAbsentEmployee);
	if (!mayChange) return "forbidden";
	if (absence.status !== "pending" && absence.status !== "approved") return "absence_closed";
	return comparePlainDates(parsePlainDate(absence.endDate), parsePlainDate(input.today)) < 0
		? "absence_closed"
		: "allowed";
}

/** Logical calendar dates of an absence, inclusive (YYYY-MM-DD). */
export interface PlainDateSpan {
	startDate: string;
	endDate: string;
}

/**
 * When a colleague is away during the requested dates, for the deputy picker
 * ("Away 3–5 Jun"): their own absences that overlap the requested dates, each
 * with its full dates, overlapping and back-to-back ones joined, in order.
 * Shows only that they are away, never why.
 */
export function deputyAwayPeriods(
	absences: readonly PlainDateSpan[],
	requested: PlainDateSpan,
): PlainDateSpan[] {
	const requestedStart = parsePlainDate(requested.startDate);
	const requestedEnd = parsePlainDate(requested.endDate);
	const overlapping = absences
		.map((absence) => ({
			start: parsePlainDate(absence.startDate),
			end: parsePlainDate(absence.endDate),
		}))
		.filter(
			({ start, end }) =>
				comparePlainDates(start, requestedEnd) <= 0 && comparePlainDates(end, requestedStart) >= 0,
		)
		.sort((left, right) => comparePlainDates(left.start, right.start));
	const periods: Array<{ start: PlainDate; end: PlainDate }> = [];
	for (const absence of overlapping) {
		const last = periods.at(-1);
		if (last && comparePlainDates(absence.start, last.end.add({ days: 1 })) <= 0) {
			if (comparePlainDates(absence.end, last.end) > 0) last.end = absence.end;
			continue;
		}
		periods.push({ ...absence });
	}
	return periods.map(({ start, end }) => ({
		startDate: start.toString(),
		endDate: end.toString(),
	}));
}

/**
 * Whether a deputy can use the approval inbox: a manager or admin role, or an
 * approve/manage Approval permission. Any other deputy is a contact only and
 * cannot decide approvals for the employee they cover (ADR 0002). Shared with
 * the deputy-decision slices of #802.
 */
export function canDeputyDecideApprovals(principal: PrincipalContext): boolean {
	if (!principal.employee) return false;
	return canAccessApprovalInbox(defineAbilityFor(principal), principal.employee);
}

/** An absence's deputy as its approver sees them (#1011). */
export interface AbsenceDeputyView {
	id: string;
	name: string;
	/** False: a contact only, who cannot decide approvals for the absent employee. */
	canDecideApprovals: boolean;
}
