"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { DEPUTY_REFUSAL_MESSAGES } from "@/lib/absences/deputy";
import {
	changeAbsenceDeputy as changeAbsenceDeputyInStore,
	type DeputyCandidate,
	listDeputyCandidates,
	loadDeputyDecisionCapability,
} from "@/lib/absences/deputy-store";
import { comparePlainDates, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Deputies on absences (#1011, spec #802): the picker's colleagues, whether a
 * deputy can decide approvals, and changing the deputy of an existing absence.
 */

const logger = createLogger("AbsenceDeputyActions");
const NOT_FOUND = "Absence not found";

interface DeputyActor {
	employeeId: string;
	userId: string;
	organizationId: string;
	role: "admin" | "manager" | "employee";
}

async function resolveActor(): Promise<DeputyActor | null> {
	const { getRequestSession } = await import("@/lib/auth/request-session");
	const session = await getRequestSession();
	const organizationId = session?.session.activeOrganizationId;
	if (!session?.user || !organizationId) return null;
	const [actor] = await db
		.select({ id: employee.id, role: employee.role })
		.from(employee)
		.where(
			and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
	return actor
		? { employeeId: actor.id, userId: session.user.id, organizationId, role: actor.role }
		: null;
}

function unauthenticated(): ServerActionResult<never> {
	return { success: false, error: "Authentication required", code: "AuthenticationError" };
}

function isPlainDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return parsePlainDate(value).toString() === value;
	} catch {
		return false;
	}
}

/** The absent employee is the actor, or one an admin or their manager records for. */
async function mayActForEmployee(actor: DeputyActor, employeeId: string): Promise<boolean> {
	if (employeeId === actor.employeeId) return true;
	const [target] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, actor.organizationId)))
		.limit(1);
	if (!target) return false;
	if (actor.role === "admin") return true;
	if (actor.role !== "manager") return false;
	const [link] = await db
		.select({ id: employeeManagers.id })
		.from(employeeManagers)
		.where(
			and(
				eq(employeeManagers.employeeId, employeeId),
				eq(employeeManagers.managerId, actor.employeeId),
			),
		)
		.limit(1);
	return Boolean(link);
}

/**
 * Colleagues who can be named as deputy for the signed-in employee, or for
 * `employeeId` when an admin or their manager records an absence for them,
 * with when each is away during the requested dates.
 */
export async function getDeputyCandidates(input: {
	/** Without dates, nobody is marked as away. */
	startDate?: string;
	endDate?: string;
	employeeId?: string;
}): Promise<ServerActionResult<DeputyCandidate[]>> {
	try {
		const actor = await resolveActor();
		if (!actor) return unauthenticated();
		const { startDate, endDate } = input ?? {};
		const requested =
			startDate === undefined && endDate === undefined
				? null
				: isPlainDate(startDate) &&
						isPlainDate(endDate) &&
						comparePlainDates(parsePlainDate(startDate), parsePlainDate(endDate)) <= 0
					? { startDate, endDate }
					: undefined;
		if (requested === undefined) {
			return { success: false, error: "Invalid dates", code: "ValidationError" };
		}
		const absentEmployeeId = input?.employeeId ?? actor.employeeId;
		if (!isCanonicalUuid(absentEmployeeId) || !(await mayActForEmployee(actor, absentEmployeeId))) {
			return { success: false, error: "Employee not found", code: "NotFoundError" };
		}
		return {
			success: true,
			data: await listDeputyCandidates(db, {
				organizationId: actor.organizationId,
				absentEmployeeId,
				requested,
			}),
		};
	} catch (error) {
		logger.error({ error }, "Failed to list deputy candidates");
		return { success: false, error: "Failed to load colleagues", code: "UNKNOWN_ERROR" };
	}
}

/** Whether a picked deputy can decide approvals, or is shown as a contact only. */
export async function getDeputyDecisionCapability(
	deputyEmployeeId: string,
): Promise<ServerActionResult<{ canDecideApprovals: boolean }>> {
	try {
		const actor = await resolveActor();
		if (!actor) return unauthenticated();
		const canDecideApprovals = isCanonicalUuid(deputyEmployeeId)
			? await loadDeputyDecisionCapability(db, {
					organizationId: actor.organizationId,
					deputyEmployeeId,
				})
			: false;
		return { success: true, data: { canDecideApprovals } };
	} catch (error) {
		logger.error({ error }, "Failed to load deputy decision capability");
		return { success: false, error: "Failed to check the deputy", code: "UNKNOWN_ERROR" };
	}
}

/**
 * Names, changes or removes the deputy of a pending or approved absence until
 * it has ended. No new approval is needed; every change is audit-logged.
 */
export async function changeAbsenceDeputy(input: {
	absenceId: string;
	deputyEmployeeId: string | null;
}): Promise<ServerActionResult<{ deputyEmployeeId: string | null }>> {
	try {
		const actor = await resolveActor();
		if (!actor) return unauthenticated();
		const deputyEmployeeId = input?.deputyEmployeeId ?? null;
		if (!isCanonicalUuid(input?.absenceId)) {
			return { success: false, error: NOT_FOUND, code: "NotFoundError" };
		}
		if (deputyEmployeeId !== null && !isCanonicalUuid(deputyEmployeeId)) {
			return {
				success: false,
				error: DEPUTY_REFUSAL_MESSAGES.deputy_unavailable,
				code: "ValidationError",
			};
		}
		const [org] = await db
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, actor.organizationId))
			.limit(1);
		const today = systemClock
			.nowInstant()
			.toZonedDateTimeISO(org?.timezone || "UTC")
			.toPlainDate()
			.toString();

		const result = await changeAbsenceDeputyInStore(db, {
			organizationId: actor.organizationId,
			absenceId: input.absenceId,
			deputyEmployeeId,
			actor,
			today,
		});
		switch (result.kind) {
			case "changed":
			case "unchanged":
				return { success: true, data: { deputyEmployeeId: result.deputyEmployeeId } };
			case "not_found":
				return { success: false, error: NOT_FOUND, code: "NotFoundError" };
			case "absence_closed":
				return {
					success: false,
					error: "The deputy can no longer be changed: this absence has ended.",
					code: "ConflictError",
				};
			case "refused":
				return {
					success: false,
					error: DEPUTY_REFUSAL_MESSAGES[result.refusal],
					code: "ValidationError",
				};
		}
	} catch (error) {
		logger.error({ error }, "Failed to change the deputy of an absence");
		return { success: false, error: "Failed to change the deputy", code: "UNKNOWN_ERROR" };
	}
}
