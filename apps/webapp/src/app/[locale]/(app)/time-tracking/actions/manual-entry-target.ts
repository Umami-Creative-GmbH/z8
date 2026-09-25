import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { getPrincipalContext } from "@/lib/auth-helpers";
import { asAppSubject, defineAbilityFor } from "@/lib/authorization";
import { getAvailableCategoriesForEmployee } from "@/lib/query/work-category.queries";
import { readAppendAdmission } from "@/lib/time-tracking/work-transaction";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { getAssignedProjectsWithHours } from "./entry-helpers";
import type {
	AssignedProject,
	ManualEntryCategoryChoice,
	ManualEntryTargetContext,
	ManualEntryTargetZoneSource,
} from "./types";

/**
 * Manual-entry target module.
 *
 * One place answers "who may this actor create manual work for, in which zone,
 * and with which project/category choices". The advisory form-context read and
 * the authoritative manual-entry action both go through it, so the choices a
 * form offers and the rules a submission is checked against cannot drift.
 */

export const MANUAL_ENTRY_TARGET_AUTH_ERROR =
	"Not authorized to create time entries for this employee";

type Employee = typeof employee.$inferSelect;

export type ManualEntryTargetResolution =
	| { success: true; targetEmployee: Employee; isOwnEntry: boolean }
	| { success: false; error: string };

export interface ManualEntryTargetZone {
	timezone: string;
	source: ManualEntryTargetZoneSource;
}

/**
 * Resolve the employee a manual entry is created for.
 *
 * Self entries need no on-behalf grant. Anyone else requires explicit
 * `create TimeEntry` authorization for an active employee in the actor's
 * organization: org owners/admins for any such employee, managers for their
 * direct reports. Read access to the employee is not enough.
 */
export async function resolveManualEntryTarget(params: {
	currentEmployee: Employee;
	requestedEmployeeId?: string | null;
}): Promise<ManualEntryTargetResolution> {
	const { currentEmployee, requestedEmployeeId } = params;
	if (!requestedEmployeeId || requestedEmployeeId === currentEmployee.id) {
		return { success: true, targetEmployee: currentEmployee, isOwnEntry: true };
	}

	const principal = await getPrincipalContext();
	if (
		!principal ||
		principal.activeOrganizationId !== currentEmployee.organizationId ||
		(principal.employee !== null &&
			principal.employee.id !== currentEmployee.id)
	) {
		return { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
	}

	const targetEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, requestedEmployeeId),
			eq(employee.organizationId, currentEmployee.organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!targetEmployee) {
		return { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
	}

	const canCreateForTarget = defineAbilityFor(principal).can(
		"create",
		asAppSubject("TimeEntry", {
			employeeId: targetEmployee.id,
			organizationId: targetEmployee.organizationId,
			teamId: targetEmployee.teamId,
		}),
	);

	return canCreateForTarget
		? { success: true, targetEmployee, isOwnEntry: false }
		: { success: false, error: MANUAL_ENTRY_TARGET_AUTH_ERROR };
}

/**
 * The zone a manual entry for this target is displayed and interpreted in:
 * the target's saved timezone, then the organization's, then UTC. It never
 * depends on the actor or their browser.
 */
export async function resolveManualEntryTargetZone(
	targetEmployee: Pick<Employee, "userId" | "organizationId">,
	/** Protected preparation passes its transaction; defaults to the global client. */
	reader: Pick<typeof db, "query"> = db,
): Promise<ManualEntryTargetZone> {
	const [settings, organizationRecord] = await Promise.all([
		reader.query.userSettings.findFirst({
			where: eq(userSettings.userId, targetEmployee.userId),
			columns: { timezone: true },
		}),
		reader.query.organization.findFirst({
			where: eq(organization.id, targetEmployee.organizationId),
			columns: { timezone: true },
		}),
	]);

	const resolution = resolvePersonalTimezone({
		userTimezone: settings?.timezone,
		organizationTimezone: organizationRecord?.timezone ?? undefined,
	});

	return {
		timezone: resolution.timezone,
		source: resolution.source === "user" ? "employee" : resolution.source,
	};
}

/**
 * Projects the target can book to: active, in a bookable status, and assigned
 * to the target directly or through their team. Assignments carry no effective
 * dates, so none are applied.
 */
export async function listManualEntryProjectChoices(
	targetEmployee: Pick<Employee, "id" | "organizationId" | "teamId">,
): Promise<AssignedProject[]> {
	const { projectsById, hoursByProjectId } = await getAssignedProjectsWithHours(
		targetEmployee.id,
		targetEmployee.organizationId,
		targetEmployee.teamId,
	);

	return Array.from(projectsById.values())
		.map((project) => ({
			id: project.id,
			name: project.name,
			color: project.color,
			status: project.status,
			budgetHours: project.budgetHours ? Number(project.budgetHours) : null,
			deadline: project.deadline?.toISOString() ?? null,
			totalHoursBooked: hoursByProjectId.get(project.id) ?? 0,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Categories from the target's currently effective category-set assignment
 * (employee, then team, then organization), scoped to the target's organization.
 */
export async function listManualEntryCategoryChoices(
	targetEmployee: Pick<Employee, "id" | "organizationId">,
): Promise<ManualEntryCategoryChoice[]> {
	const categories = await getAvailableCategoriesForEmployee(
		targetEmployee.id,
		targetEmployee.organizationId,
	);

	return categories.map((category) => ({
		id: category.id,
		name: category.name,
		factor: category.factor,
		color: category.color,
	}));
}

/**
 * Advisory form context for a creation-authorized target. The browser uses it
 * to show the effective zone and eligible choices; submissions are still
 * checked against the same rules on the server.
 */
export async function getManualEntryTargetContextForEmployee(params: {
	currentEmployee: Employee;
	requestedEmployeeId?: string | null;
}): Promise<
	| { success: true; data: ManualEntryTargetContext }
	| { success: false; error: string }
> {
	const target = await resolveManualEntryTarget(params);
	if (!target.success) {
		return target;
	}

	const { targetEmployee, isOwnEntry } = target;
	const [zone, projects, categories, targetUser, admission] = await Promise.all([
		resolveManualEntryTargetZone(targetEmployee),
		listManualEntryProjectChoices(targetEmployee),
		listManualEntryCategoryChoices(targetEmployee),
		db.query.user.findFirst({
			where: eq(user.id, targetEmployee.userId),
			columns: { firstName: true, lastName: true, name: true, email: true },
		}),
		readAppendAdmission(db, targetEmployee.organizationId),
	]);

	return {
		success: true,
		data: {
			targetEmployeeId: targetEmployee.id,
			targetName: targetUser ? buildAuthUserDisplayName(targetUser) : "",
			isOwnEntry,
			timezone: zone.timezone,
			timezoneSource: zone.source,
			manualCommandVersion: admission === "append" ? 2 : 1,
			recoveryContext: {
				userId: params.currentEmployee.userId,
				organizationId: params.currentEmployee.organizationId,
			},
			projects,
			categories,
		},
	};
}
