import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { coverageRule, employee, location, shiftTemplate, subareaEmployee, teamPermissions } from "@/db/schema";
import type { AuthContext } from "@/lib/auth-helpers";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import type { SettingsAccessTier } from "@/lib/settings-access";

export interface ScopedSchedulingLocation {
	id: string;
	name: string;
	subareas: Array<{
		id: string;
		name: string;
		isActive: boolean;
	}>;
}

export interface SchedulingSettingsAccessContext {
	authContext: AuthContext;
	accessTier: SettingsAccessTier;
	organizationId: string;
	canManageTeamSettings: boolean;
	manageableTeamIds: Set<string> | null;
	manageableShiftTemplateSubareaIds: Set<string> | null;
	manageableSubareaIds: Set<string> | null;
	canAccessShiftTemplates: boolean;
	canAccessCoverageRules: boolean;
	canManageCoverageSettings: boolean;
}

export function getManagedShiftTemplateSubareaIds(input: {
	organizationId: string;
	manageableTeamIds: Set<string> | null;
	subareaAssignments: Array<{
		subareaId: string;
		employeeTeamId: string | null;
		employeeOrganizationId: string;
	}>;
}) {
	if (!input.manageableTeamIds) {
		return null;
	}

	const manageableTeamIds = input.manageableTeamIds;

	return new Set(
		input.subareaAssignments
			.filter(
				(assignment) =>
					assignment.employeeOrganizationId === input.organizationId &&
					assignment.employeeTeamId !== null &&
					manageableTeamIds.has(assignment.employeeTeamId),
			)
			.map((assignment) => assignment.subareaId),
	);
}

export function canAccessShiftTemplateSettings(
	accessTier: SettingsAccessTier,
	canManageTeamSettings: boolean,
	manageableSubareaIds: Set<string> | null,
) {
	if (accessTier === "orgAdmin") {
		return true;
	}

	return accessTier === "manager" && canManageTeamSettings && (manageableSubareaIds?.size ?? 0) > 0;
}

export function canAccessCoverageRuleSettings(
	accessTier: SettingsAccessTier,
	manageableSubareaIds: Set<string> | null,
) {
	if (accessTier === "orgAdmin") {
		return true;
	}

	return accessTier === "manager" && (manageableSubareaIds?.size ?? 0) > 0;
}

export function canManageScopedSchedulingSubarea(
	accessTier: SettingsAccessTier,
	manageableSubareaIds: Set<string> | null,
	subareaId: string | null | undefined,
) {
	if (accessTier === "orgAdmin") {
		return true;
	}

	if (!subareaId || !manageableSubareaIds) {
		return false;
	}

	return manageableSubareaIds.has(subareaId);
}

export function filterItemsToManageableSubareas<T extends { subareaId: string | null | undefined }>(
	items: T[],
	manageableSubareaIds: Set<string> | null,
) {
	if (!manageableSubareaIds) {
		return items;
	}

	return items.filter((item) => item.subareaId && manageableSubareaIds.has(item.subareaId));
}

export async function getSchedulingSettingsAccessContext(): Promise<SchedulingSettingsAccessContext | null> {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return null;
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId || settingsRouteContext.accessTier === "member") {
		return null;
	}

	if (settingsRouteContext.accessTier === "orgAdmin") {
		return {
			...settingsRouteContext,
			organizationId,
			canManageTeamSettings: true,
			manageableTeamIds: null,
			manageableShiftTemplateSubareaIds: null,
			manageableSubareaIds: null,
			canAccessShiftTemplates: true,
			canAccessCoverageRules: true,
			canManageCoverageSettings: true,
		};
	}

	const currentEmployee = settingsRouteContext.authContext.employee;

	if (!currentEmployee || currentEmployee.role !== "manager") {
		return null;
	}

	const [managerTeamPermissions, managerSubareaAssignments] = await Promise.all([
		db.query.teamPermissions.findMany({
			where: eq(teamPermissions.employeeId, currentEmployee.id),
			columns: {
				teamId: true,
				canManageTeamSettings: true,
			},
		}),
		db.query.subareaEmployee.findMany({
			where: eq(subareaEmployee.employeeId, currentEmployee.id),
			columns: {
				subareaId: true,
			},
		}),
	]);

	const canManageTeamSettings = managerTeamPermissions.some((permission) => permission.canManageTeamSettings);
	const manageableTeamIds = new Set(
		managerTeamPermissions
			.filter((permission) => permission.canManageTeamSettings && permission.teamId)
			.map((permission) => permission.teamId as string),
	);
	const manageableSubareaIds = new Set(
		managerSubareaAssignments.map((assignment) => assignment.subareaId),
	);
	const manageableShiftTemplateSubareaIds =
		manageableTeamIds.size === 0
			? new Set<string>()
			: new Set(
				(
					await db.query.employee.findMany({
						where: and(
							eq(employee.organizationId, organizationId),
							inArray(employee.teamId, [...manageableTeamIds]),
						),
						columns: {},
						with: {
							subareaAssignments: {
								columns: {
									subareaId: true,
								},
							},
						},
					})
				).flatMap((teamEmployee) =>
					teamEmployee.subareaAssignments.map((assignment) => assignment.subareaId),
				),
			);

	return {
		...settingsRouteContext,
		organizationId,
		canManageTeamSettings,
		manageableTeamIds,
		manageableShiftTemplateSubareaIds,
		manageableSubareaIds,
		canAccessShiftTemplates: canAccessShiftTemplateSettings(
			settingsRouteContext.accessTier,
			canManageTeamSettings,
			manageableShiftTemplateSubareaIds,
		),
		canAccessCoverageRules: canAccessCoverageRuleSettings(
			settingsRouteContext.accessTier,
			manageableSubareaIds,
		),
		canManageCoverageSettings: false,
	};
}

export async function getScopedSchedulingLocationsForSettings(input: {
	organizationId: string;
	manageableSubareaIds: Set<string> | null;
}): Promise<ScopedSchedulingLocation[]> {
	const manageableSubareaIds = input.manageableSubareaIds;
	const locations = await db.query.location.findMany({
		where: eq(location.organizationId, input.organizationId),
		with: {
			subareas: {
				columns: {
					id: true,
					name: true,
					isActive: true,
				},
			},
		},
		orderBy: [desc(location.createdAt)],
	});

	return locations
		.map((currentLocation) => ({
			id: currentLocation.id,
			name: currentLocation.name,
			subareas: manageableSubareaIds
				? currentLocation.subareas.filter((subarea) => manageableSubareaIds.has(subarea.id))
				: currentLocation.subareas,
		}))
		.filter((currentLocation) => currentLocation.subareas.length > 0);
}

export async function getShiftTemplateScopeTarget(templateId: string) {
	return await db.query.shiftTemplate.findFirst({
		where: eq(shiftTemplate.id, templateId),
		columns: {
			id: true,
			organizationId: true,
			subareaId: true,
		},
	});
}

export async function getCoverageRuleScopeTarget(ruleId: string) {
	return await db.query.coverageRule.findFirst({
		where: eq(coverageRule.id, ruleId),
		columns: {
			id: true,
			organizationId: true,
			subareaId: true,
		},
	});
}
