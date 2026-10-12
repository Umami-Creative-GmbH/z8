import "server-only";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee, userSettings } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { buildCoverDuties, type CoverDuties, UPCOMING_COVER_DAYS } from "./cover-duties";
import { canOpenEmployeeProfile, type DeputyDisplay, type DeputyViewer } from "./deputy-visibility";
import { loadManagedEmployeeIds } from "./managed-employees";

export type { DeputyDisplay };

/**
 * Reads behind showing an absence's deputy (#1012): who is looking, the
 * deputy's display name and profile link, and the viewer's cover duties.
 */

type Executor = Pick<typeof db, "select">;

/** The signed-in employee looking at absences, with what decides their view. */
export interface DeputyViewerContext extends DeputyViewer {
	employeeId: string;
	/** An owner or admin member of the organization (the settings org-admin tier). */
	isOrganizationAdmin: boolean;
}

/** The viewer's active employee in the organization, or null without access. */
export async function loadDeputyViewer(
	executor: Executor,
	input: { organizationId: string; userId: string },
): Promise<DeputyViewerContext | null> {
	const [viewer] = await executor
		.select({ id: employee.id, role: employee.role })
		.from(employee)
		.where(
			and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
	if (!viewer) return null;

	const [membership, managed] = await Promise.all([
		executor
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		loadManagedEmployeeIds(executor, {
			organizationId: input.organizationId,
			managerEmployeeId: viewer.id,
		}),
	]);
	const membershipRole = membership[0]?.role;
	return {
		employeeId: viewer.id,
		role: viewer.role,
		isOrganizationAdmin:
			hasOrganizationRole(membershipRole, "owner") || hasOrganizationRole(membershipRole, "admin"),
		managedEmployeeIds: managed,
	};
}

/** Deputies of the organization by employee id, named and linked for the viewer. */
export async function loadDeputyDisplays(
	executor: Executor,
	input: {
		organizationId: string;
		viewer: DeputyViewerContext | null;
		deputyEmployeeIds: readonly string[];
	},
): Promise<Map<string, DeputyDisplay>> {
	const deputyEmployeeIds = [...new Set(input.deputyEmployeeIds)];
	if (deputyEmployeeIds.length === 0) return new Map();
	const deputies = await executor
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, deputyEmployeeIds),
			),
		);
	const { viewer } = input;
	return new Map(
		deputies.map((deputy) => [
			deputy.id,
			{
				id: deputy.id,
				name: deputy.name,
				canOpenProfile: viewer
					? canOpenEmployeeProfile({
							viewerIsOrganizationAdmin: viewer.isOrganizationAdmin,
							viewerRole: viewer.role,
							managesEmployee: viewer.managedEmployeeIds.has(deputy.id),
						})
					: false,
			},
		]),
	);
}

/**
 * The viewer's running and upcoming cover duties in the organization (the
 * "Covering for" dashboard card). Loads a slightly wider date window in UTC,
 * then decides per absent employee's timezone.
 */
export async function loadCoverDuties(
	executor: Executor,
	input: { organizationId: string; viewer: DeputyViewerContext; now: Instant },
): Promise<CoverDuties> {
	// Every timezone is within a day of UTC, so this window holds every candidate.
	const utcToday = plainDateAt(input.now, "UTC");
	const [rows, orgRows] = await Promise.all([
		executor
			.select({
				absenceId: absenceEntry.id,
				absentEmployeeId: absenceEntry.employeeId,
				absentEmployeeName: user.name,
				absentEmployeeTimezone: userSettings.timezone,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				status: absenceEntry.status,
				categoryName: absenceCategory.name,
				categoryColor: absenceCategory.color,
			})
			.from(absenceEntry)
			.innerJoin(employee, eq(employee.id, absenceEntry.employeeId))
			.innerJoin(user, eq(user.id, employee.userId))
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.innerJoin(absenceCategory, eq(absenceCategory.id, absenceEntry.categoryId))
			.where(
				and(
					eq(absenceEntry.organizationId, input.organizationId),
					eq(absenceEntry.deputyEmployeeId, input.viewer.employeeId),
					eq(absenceEntry.status, "approved"),
					eq(employee.organizationId, input.organizationId),
					eq(absenceCategory.organizationId, input.organizationId),
					gte(absenceEntry.endDate, utcToday.subtract({ days: 1 }).toString()),
					lte(absenceEntry.startDate, utcToday.add({ days: UPCOMING_COVER_DAYS + 1 }).toString()),
				),
			),
		executor
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.limit(1),
	]);

	return buildCoverDuties({
		absences: rows.map((row) => ({
			absenceId: row.absenceId,
			absentEmployeeId: row.absentEmployeeId,
			absentEmployeeName: row.absentEmployeeName,
			absentEmployeeTimezone: row.absentEmployeeTimezone,
			startDate: row.startDate,
			endDate: row.endDate,
			status: row.status,
			category: { name: row.categoryName, color: row.categoryColor },
		})),
		viewer: input.viewer,
		organizationTimezone: orgRows[0]?.timezone ?? null,
		now: input.now,
	});
}
