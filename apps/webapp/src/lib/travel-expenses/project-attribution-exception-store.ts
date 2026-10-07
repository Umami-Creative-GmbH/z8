import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	project,
	travelExpenseProjectAttributionException,
	travelExpenseProjectHistoryCapture,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import {
	type ProjectAttributionExceptionDraft,
	type ProjectAttributionExceptionError,
	parseProjectAttributionExceptionDraft,
} from "./project-attribution-exception";

/**
 * Records and lists authorized project attribution exceptions (#605). The
 * caller has already checked that the actor may manage the organization's
 * expense settings; this store enforces organization scope for every
 * referenced row and refuses self-authorization. Rows are never changed.
 */

type Database = typeof appDb;

export interface ExceptionActor {
	organizationId: string;
	employeeId: string;
	userId: string;
}

export type AuthorizeProjectExceptionResult =
	| { kind: "authorized"; exceptionId: string }
	| { kind: "invalid"; errors: ProjectAttributionExceptionError[] }
	/** An expense administrator never authorizes an exception for their own expenses. */
	| { kind: "self_authorization" }
	| { kind: "employee_not_found" }
	| { kind: "project_not_found" };

/**
 * Today's calendar date and the first day of captured assignment history
 * (#605) in the organization's zone. An organization without a recorded
 * capture start was created after capture began: its history starts with it.
 */
async function organizationCalendar(database: Database, organizationId: string, now: Instant) {
	const [row] = await database
		.select({
			timezone: organization.timezone,
			createdAt: organization.createdAt,
			capturedFrom: travelExpenseProjectHistoryCapture.capturedFrom,
		})
		.from(organization)
		.leftJoin(
			travelExpenseProjectHistoryCapture,
			eq(travelExpenseProjectHistoryCapture.organizationId, organization.id),
		)
		.where(eq(organization.id, organizationId))
		.limit(1);
	const timeZone = resolvePersonalTimezone({
		organizationTimezone: row?.timezone ?? undefined,
	}).timezone;
	const day = (instant: Instant) => instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
	const capturedFrom = row?.capturedFrom ?? row?.createdAt ?? null;
	return {
		today: day(now),
		historyCapturedFrom: capturedFrom ? day(instantFromDate(capturedFrom)) : null,
	};
}

export async function authorizeProjectAttributionException(
	database: Database,
	actor: ExceptionActor,
	input: ProjectAttributionExceptionDraft,
	now: Instant = systemClock.nowInstant(),
): Promise<AuthorizeProjectExceptionResult> {
	if (input.employeeId === actor.employeeId) return { kind: "self_authorization" };
	const calendar = await organizationCalendar(database, actor.organizationId, now);
	const parsed = parseProjectAttributionExceptionDraft(
		input,
		calendar.today,
		calendar.historyCapturedFrom,
	);
	if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
	const [subject] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, actor.organizationId)),
		)
		.limit(1);
	if (!subject) return { kind: "employee_not_found" };
	const [target] = await database
		.select({ id: project.id })
		.from(project)
		.where(and(eq(project.id, input.projectId), eq(project.organizationId, actor.organizationId)))
		.limit(1);
	if (!target) return { kind: "project_not_found" };
	const [row] = await database
		.insert(travelExpenseProjectAttributionException)
		.values({
			organizationId: actor.organizationId,
			employeeId: parsed.draft.employeeId,
			projectId: parsed.draft.projectId,
			validFrom: parsed.draft.validFrom,
			validTo: parsed.draft.validTo,
			reason: parsed.draft.reason,
			evidence: parsed.draft.evidence,
			authorizedByEmployeeId: actor.employeeId,
			authorizedByUserId: actor.userId,
			authorizedAt: dateFromInstant(now),
		})
		.returning({ id: travelExpenseProjectAttributionException.id });
	if (!row) throw new Error("Failed to record the project attribution exception");
	return { kind: "authorized", exceptionId: row.id };
}

export interface ProjectAttributionExceptionView {
	id: string;
	employeeId: string;
	employeeName: string | null;
	projectId: string;
	projectName: string;
	validFrom: string;
	validTo: string;
	reason: string;
	evidence: string;
	authorizedByName: string | null;
	authorizedAt: string;
}

/** The organization's exceptions, most recently authorized first. */
export async function listProjectAttributionExceptions(
	database: Database,
	organizationId: string,
	limit = 200,
): Promise<ProjectAttributionExceptionView[]> {
	const subject = alias(employee, "subject_employee");
	const subjectUser = alias(user, "subject_user");
	const authorizer = alias(user, "authorizer_user");
	const rows = await database
		.select({
			id: travelExpenseProjectAttributionException.id,
			employeeId: travelExpenseProjectAttributionException.employeeId,
			firstName: subject.firstName,
			lastName: subject.lastName,
			userName: subjectUser.name,
			projectId: travelExpenseProjectAttributionException.projectId,
			projectName: project.name,
			validFrom: travelExpenseProjectAttributionException.validFrom,
			validTo: travelExpenseProjectAttributionException.validTo,
			reason: travelExpenseProjectAttributionException.reason,
			evidence: travelExpenseProjectAttributionException.evidence,
			authorizedByName: authorizer.name,
			authorizedAt: travelExpenseProjectAttributionException.authorizedAt,
		})
		.from(travelExpenseProjectAttributionException)
		.innerJoin(
			project,
			and(
				eq(project.id, travelExpenseProjectAttributionException.projectId),
				eq(project.organizationId, travelExpenseProjectAttributionException.organizationId),
			),
		)
		.innerJoin(
			subject,
			and(
				eq(subject.id, travelExpenseProjectAttributionException.employeeId),
				eq(subject.organizationId, travelExpenseProjectAttributionException.organizationId),
			),
		)
		.leftJoin(subjectUser, eq(subjectUser.id, subject.userId))
		.leftJoin(
			authorizer,
			eq(authorizer.id, travelExpenseProjectAttributionException.authorizedByUserId),
		)
		.where(eq(travelExpenseProjectAttributionException.organizationId, organizationId))
		.orderBy(
			desc(travelExpenseProjectAttributionException.authorizedAt),
			desc(travelExpenseProjectAttributionException.id),
		)
		.limit(limit);
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		employeeName: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.userName || null,
		projectId: row.projectId,
		projectName: row.projectName,
		validFrom: row.validFrom,
		validTo: row.validTo,
		reason: row.reason,
		evidence: row.evidence,
		authorizedByName: row.authorizedByName ?? null,
		authorizedAt: row.authorizedAt.toISOString(),
	}));
}
