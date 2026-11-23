import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { type Clock, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { currentOrganizationAdminUserIds } from "@/lib/notifications/manager-notice-recipients";
import { notifyPlannedEngagementEndNeedsReview } from "@/lib/notifications/planned-engagement-end-needs-review";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";

const logger = createLogger("joining");

/** The departure a contractor invitation's planned end date becomes (#1995). */
export type PlannedEngagementEnd = {
	organizationId: string;
	employeeId: string;
	/** The contractor's user. */
	userId: string;
	/** Org-local ISO calendar date. */
	lastWorkingDay: string;
	/** The invitation draft's id: the departure's request id, so a repeated step replays. */
	requestId: string;
	invitationId: string | null;
	/** The admin who prepared the invitation; null when nobody can be named. */
	actorUserId: string | null;
};

/**
 * Why the planned end was not scheduled as planned. `planned_end_passed`:
 * the day had passed by the time they joined, and today became the leaving
 * date instead. Every other reason scheduled nothing.
 */
type NotApplied =
	| { reason: "planned_end_passed"; scheduledLastWorkingDay: string }
	| { reason: "schedule_refused"; refusal: string }
	| { reason: "offboarding_not_released" }
	| { reason: "no_admin_actor" };

/**
 * Schedules the planned end as a canonical departure by the admin who prepared
 * the invitation, once the joining committed. A planned end is never dropped
 * silently: when it had already passed, the leaving date is today in the
 * organization's timezone (the earliest a scheduled departure allows, so the
 * contractor never keeps access past the end the organization set), and when
 * nothing could be scheduled the admins are told to do it by hand. Either way
 * an audit entry records it and the organization's admins get a notice. Never throws.
 */
export async function schedulePlannedEngagementEnd(
	planned: PlannedEngagementEnd,
	clock: Clock = systemClock,
): Promise<void> {
	let notApplied: NotApplied | null = null;
	try {
		notApplied = await schedule(planned, clock);
	} catch (error) {
		logger.error(
			{ error, organizationId: planned.organizationId, employeeId: planned.employeeId },
			"Could not schedule the planned end of a contractor engagement",
		);
		notApplied = { reason: "schedule_refused", refusal: refusalOf(error) };
	}
	if (notApplied) await reportNotApplied(planned, notApplied);
}

async function schedule(planned: PlannedEngagementEnd, clock: Clock): Promise<NotApplied | null> {
	const { EMPLOYEE_OFFBOARDING_RELEASE_READY } = await import("../release");
	if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) return { reason: "offboarding_not_released" };
	if (!planned.actorUserId) return { reason: "no_admin_actor" };
	const { today } = await loadOrganizationDay(db, {
		organizationId: planned.organizationId,
		now: clock.nowInstant(),
	});
	const passed = Temporal.PlainDate.compare(parsePlainDate(planned.lastWorkingDay), today) < 0;
	const lastWorkingDay = passed ? today.toString() : planned.lastWorkingDay;
	const { createProductionDepartureCommands } = await import("../runtime");
	await createProductionDepartureCommands().scheduleDeparture(
		{ userId: planned.actorUserId, organizationId: planned.organizationId },
		{
			employeeId: planned.employeeId,
			requestId: planned.requestId,
			expectedRevision: null,
			lastWorkingDay,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		},
	);
	return passed ? { reason: "planned_end_passed", scheduledLastWorkingDay: lastWorkingDay } : null;
}

/** A departure command's refusal code, such as `actor_not_authorized`. */
function refusalOf(error: unknown): string {
	if (
		error instanceof Error &&
		error.name === "DepartureCommandError" &&
		"code" in error &&
		typeof error.code === "string"
	) {
		return error.code;
	}
	return "unexpected_error";
}

/** Best effort: the audit entry and the admins' notice never fail the step. */
async function reportNotApplied(planned: PlannedEngagementEnd, notApplied: NotApplied) {
	try {
		await withAuditTrail((audit) =>
			audit.record(db, {
				organizationId: planned.organizationId,
				action: AuditAction.EMPLOYEE_PLANNED_ENGAGEMENT_END_NOT_APPLIED,
				actorUserId: planned.actorUserId ?? planned.userId,
				targetType: "employee",
				targetId: planned.employeeId,
				employeeId: planned.employeeId,
				metadata: {
					...notApplied,
					plannedEndDate: planned.lastWorkingDay,
					draftId: planned.requestId,
					invitationId: planned.invitationId,
				},
			}),
		);
	} catch (error) {
		logger.error(
			{ error, organizationId: planned.organizationId, employeeId: planned.employeeId },
			"Could not record that a planned engagement end was not applied",
		);
	}
	try {
		const recipientUserIds = await currentOrganizationAdminUserIds(db, {
			organizationId: planned.organizationId,
		});
		if (recipientUserIds.length === 0) return;
		const person = await db.query.user.findFirst({
			where: eq(user.id, planned.userId),
			columns: { name: true, email: true },
		});
		await notifyPlannedEngagementEndNeedsReview({
			organizationId: planned.organizationId,
			employeeId: planned.employeeId,
			draftId: planned.requestId,
			name: person?.name || person?.email || planned.employeeId,
			plannedEndDate: planned.lastWorkingDay,
			leavingDate:
				notApplied.reason === "planned_end_passed" ? notApplied.scheduledLastWorkingDay : null,
			recipientUserIds,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: planned.organizationId, employeeId: planned.employeeId },
			"Could not tell admins that a planned engagement end needs review",
		);
	}
}
