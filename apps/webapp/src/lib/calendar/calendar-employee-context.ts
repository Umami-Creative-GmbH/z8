import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { asAppSubject, defineAbilityFor, type PrincipalContext } from "@/lib/authorization";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { todayCalendarDateKey } from "./date-keys";

export interface CalendarEmployeeContext {
	employeeId: string;
	timezone: string;
	initialDateKey: string;
}

interface ResolveCalendarEmployeeContextInput {
	userId: string;
	isPlatformAdmin: boolean;
	organizationId: string;
	currentEmployeeId: string;
	requestedEmployeeId?: string;
	now?: Instant;
}

export async function resolveAuthorizedCalendarEmployeeContext({
	userId,
	isPlatformAdmin,
	organizationId,
	currentEmployeeId,
	requestedEmployeeId,
	now = systemClock.nowInstant(),
}: ResolveCalendarEmployeeContextInput): Promise<CalendarEmployeeContext | undefined> {
	const currentEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, currentEmployeeId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!currentEmployee) return undefined;

	const targetEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, requestedEmployeeId ?? currentEmployee.id),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!targetEmployee) return undefined;

	const managedRecords = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.managerId, currentEmployee.id),
		columns: { employeeId: true },
	});
	const principal: PrincipalContext = {
		userId,
		isPlatformAdmin,
		activeOrganizationId: organizationId,
		orgMembership: null,
		employee: {
			id: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			role: currentEmployee.role,
			teamId: currentEmployee.teamId,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: managedRecords.map((record) => record.employeeId),
		customRoles: [],
	};
	const ability = defineAbilityFor(principal);
	if (
		!ability.can(
			"read",
			asAppSubject("Employee", {
				id: targetEmployee.id,
				employeeId: targetEmployee.id,
				organizationId: targetEmployee.organizationId,
				teamId: targetEmployee.teamId,
			}),
		)
	) {
		return undefined;
	}

	const timezone = await getEffectiveTimezone(targetEmployee.userId, organizationId);
	return {
		employeeId: targetEmployee.id,
		timezone,
		initialDateKey: todayCalendarDateKey(timezone, now),
	};
}
