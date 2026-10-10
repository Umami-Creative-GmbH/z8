/**
 * Covering (#1015, spec #802, Approvals ADR 0002): is deputy Y covering for
 * approver X at an instant? This is the pure core: facts in, answer out, no
 * I/O. `covering-store.ts` loads the facts from the database; deputy decisions,
 * the "Covering for" inbox section, cards and summaries (#1016–#1018) ask that
 * store, never this file's callers' own queries.
 *
 * Y covers for X at instant `at` when all of these hold:
 * - the organization's "Deputies can decide approvals" setting is on;
 * - Y is active in the organization and can use the approval inbox
 *   (`canDeputyDecideApprovals`); otherwise Y is a contact only;
 * - X has an approved absence, in a category that does not count as working
 *   time, whose dates include X's local day at `at`, and that absence names Y.
 *
 * Day rules: X's local day comes from X's effective timezone (user setting,
 * then organization, then UTC). A half day counts as the whole day. Covering
 * ends after the absence's last day, with no grace period. Only the status
 * gates an absence, so one approved after it started covers from approval on.
 * Covering never chains: Z, the deputy of an absent Y, covers only for Y.
 */

import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";

/** An absence as covering reads it. Dates are inclusive `YYYY-MM-DD` calendar dates. */
export interface CoverAbsenceFacts {
	id: string;
	/** The absent employee: the approver the deputy may cover for. */
	employeeId: string;
	deputyEmployeeId: string | null;
	startDate: string;
	endDate: string;
	/** Half days never shorten a covered day; kept so the rule is explicit. */
	startPeriod: "full_day" | "am" | "pm";
	endPeriod: "full_day" | "am" | "pm";
	status: "pending" | "approved" | "rejected";
	/** The category counts as working time (`requires_work_time`, e.g. home office). */
	countsAsWorkingTime: boolean;
}

/** The deputy candidate Y, evaluated once for all approvers. */
export interface CoverDeputyFacts {
	employeeId: string;
	/** Active in the organization at the instant (`employeeHasOrganizationAccess`). */
	active: boolean;
	/** `canDeputyDecideApprovals` (manager/admin role or approve/manage Approval). */
	canUseApprovalInbox: boolean;
}

/** An approver X whose absences are in `CoverFacts.absences`. */
export interface CoverApproverFacts {
	employeeId: string;
	/** `user_settings.timezone`; null when the approver has no settings row. */
	userTimezone: string | null;
}

/** Everything covering needs, for one organization, one deputy and one instant. */
export interface CoverFacts {
	deputyDecisionsEnabled: boolean;
	at: Instant;
	organizationTimezone: string | null;
	deputy: CoverDeputyFacts;
	approvers: readonly CoverApproverFacts[];
	/** Absences of the approvers around `at`; any others are ignored. */
	absences: readonly CoverAbsenceFacts[];
}

/** Y covers for an approver at an instant, because of one absence. */
export interface Cover {
	/** The absent approver X (an employee id). */
	approverId: string;
	/**
	 * The absence that makes Y X's deputy at this instant. Of overlapping
	 * covering absences, the one that ends last.
	 */
	absenceId: string;
	/** X's local day at the instant (`YYYY-MM-DD`). */
	day: string;
	/** That absence's last day (`YYYY-MM-DD`, X's calendar): covering ends after it. */
	absenceEndDate: string;
}

/** Whether an absence covers a local day (`YYYY-MM-DD`) of its employee. */
export function absenceCoversDay(absence: CoverAbsenceFacts, day: string): boolean {
	// ISO dates sort as strings; a half-day first or last day covers the whole day.
	return (
		absence.status === "approved" &&
		!absence.countsAsWorkingTime &&
		absence.startDate <= day &&
		day <= absence.endDate
	);
}

/** The approver's local day at `at`, in their effective timezone. */
export function approverDayAt(
	at: Instant,
	approver: CoverApproverFacts,
	organizationTimezone: string | null,
): string {
	const { timezone } = resolvePersonalTimezone({
		userTimezone: approver.userTimezone ?? undefined,
		organizationTimezone: organizationTimezone ?? undefined,
	});
	return plainDateAt(at, timezone).toString();
}

/**
 * Every approver the deputy covers for at the instant, once each, in the order
 * of `facts.approvers`. Empty when the setting is off or the deputy cannot
 * decide approvals.
 */
export function resolveCovers(facts: CoverFacts): Cover[] {
	const { deputy } = facts;
	if (!facts.deputyDecisionsEnabled || !deputy.active || !deputy.canUseApprovalInbox) return [];

	const covers = new Map<string, Cover>();
	for (const approver of facts.approvers) {
		if (covers.has(approver.employeeId)) continue;
		const day = approverDayAt(facts.at, approver, facts.organizationTimezone);
		const absence = latestEnding(
			facts.absences.filter(
				(candidate) =>
					candidate.employeeId === approver.employeeId &&
					candidate.deputyEmployeeId === deputy.employeeId &&
					absenceCoversDay(candidate, day),
			),
		);
		if (absence) {
			covers.set(approver.employeeId, {
				approverId: approver.employeeId,
				absenceId: absence.id,
				day,
				absenceEndDate: absence.endDate,
			});
		}
	}
	return [...covers.values()];
}

/** The approver's cover by this deputy at the instant, or null. */
export function findCover(facts: CoverFacts, approverId: string): Cover | null {
	return resolveCovers(facts).find((cover) => cover.approverId === approverId) ?? null;
}

function latestEnding(absences: readonly CoverAbsenceFacts[]): CoverAbsenceFacts | undefined {
	return [...absences].sort(
		(left, right) => right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id),
	)[0];
}
