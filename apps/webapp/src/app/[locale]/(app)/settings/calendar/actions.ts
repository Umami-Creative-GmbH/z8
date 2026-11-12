"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
	calendarConnection,
	employee,
	locationEmployee,
	organizationCalendarSettings,
	project,
	projectAssignment,
	projectManager,
	subareaEmployee,
	teamPermissions,
} from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { getSupportedProviders, isProviderSupported } from "@/lib/calendar-sync/providers";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";

// ============================================
// TYPES
// ============================================

export interface CalendarSettings {
	// Provider settings
	googleEnabled: boolean;
	microsoft365Enabled: boolean;

	// ICS feed settings
	icsFeedsEnabled: boolean;
	teamIcsFeedsEnabled: boolean;

	// Sync settings
	autoSyncOnApproval: boolean;
	conflictDetectionRequired: boolean;

	// Event customization
	eventTitleTemplate: string;
	eventDescriptionTemplate: string | null;

	// Provider availability (based on env config)
	googleAvailable: boolean;
	microsoft365Available: boolean;
	relevantConnections: CalendarConnectionSummary[];
}

export interface CalendarConnectionSummary {
	id: string;
	employeeId: string;
	employeeName: string;
	provider: string;
	providerLabel: string;
	providerAccountId: string;
	calendarId: string;
	pushEnabled: boolean;
	conflictDetectionEnabled: boolean;
	lastSyncAt: Date | null;
	lastSyncError: string | null;
	isActive: boolean;
	createdAt: Date;
}

type CalendarConnectionWithEmployee = typeof calendarConnection.$inferSelect & {
	employee:
		| (Pick<typeof employee.$inferSelect, "id"> & {
				user: {
					firstName: string | null;
					lastName: string | null;
					name: string | null;
					email: string | null;
				} | null;
		  })
		| null;
};

export interface ManagerCalendarReadView {
	relevantConnections: CalendarConnectionSummary[];
}

const calendarSettingsSchema = z.strictObject({
	googleEnabled: z.boolean(),
	microsoft365Enabled: z.boolean(),
	icsFeedsEnabled: z.boolean(),
	teamIcsFeedsEnabled: z.boolean(),
	autoSyncOnApproval: z.boolean(),
	conflictDetectionRequired: z.boolean(),
	eventTitleTemplate: z.string().min(1).max(200),
	eventDescriptionTemplate: z.string().max(500).nullable(),
});

export type CalendarSettingsFormValues = z.infer<typeof calendarSettingsSchema>;

/**
 * The employees whose calendar connections the actor sees: everyone (null) for an
 * org admin; for a scoped manager, the employees of the teams whose settings they
 * manage, of their locations and subareas, and of the projects they manage.
 */
function scopedCalendarEmployeeIds(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		if (meetsSettingsAccess(actor.settingsAccess, "orgAdmin")) {
			return null as Set<string> | null;
		}
		if (!actor.employee) {
			return new Set<string>();
		}

		const managerId = actor.employee.id;
		const dbService = yield* DatabaseService;
		const { db } = dbService;

		const [teamPermissionRows, managerLocationRows, managerSubareaRows, managedProjectRows] =
			yield* Effect.all([
				dbService.query("calendar.scope.teamPermissions", () =>
					db.query.teamPermissions.findMany({
						where: and(
							eq(teamPermissions.employeeId, managerId),
							eq(teamPermissions.organizationId, organizationId),
						),
						columns: { teamId: true, canManageTeamSettings: true },
					}),
				),
				dbService.query("calendar.scope.managerLocations", () =>
					db.query.locationEmployee.findMany({
						where: eq(locationEmployee.employeeId, managerId),
						columns: { locationId: true },
					}),
				),
				dbService.query("calendar.scope.managerSubareas", () =>
					db.query.subareaEmployee.findMany({
						where: eq(subareaEmployee.employeeId, managerId),
						columns: { subareaId: true },
					}),
				),
				dbService.query("calendar.scope.managedProjects", () =>
					db.query.projectManager.findMany({
						where: eq(projectManager.employeeId, managerId),
						columns: { projectId: true },
					}),
				),
			]);

		const manageableTeamIds = new Set(
			teamPermissionRows.flatMap((permission) =>
				permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
			),
		);
		const manageableLocationIds = managerLocationRows
			.map((assignment) => assignment.locationId)
			.filter((locationId): locationId is string => Boolean(locationId));
		const manageableSubareaIds = managerSubareaRows
			.map((assignment) => assignment.subareaId)
			.filter((subareaId): subareaId is string => Boolean(subareaId));
		const rawManagedProjectIds = managedProjectRows.map((assignment) => assignment.projectId);
		const managedProjectIds = rawManagedProjectIds.length
			? yield* dbService.query("calendar.scope.scopedProjects", () =>
					db.query.project.findMany({
						where: and(
							eq(project.organizationId, organizationId),
							inArray(project.id, rawManagedProjectIds),
						),
						columns: { id: true },
					}),
				)
			: [];

		const projectAssignments = managedProjectIds.length
			? yield* dbService.query("calendar.scope.projectAssignments", () =>
					db.query.projectAssignment.findMany({
						where: and(
							eq(projectAssignment.organizationId, organizationId),
							inArray(
								projectAssignment.projectId,
								managedProjectIds.map((managedProject) => managedProject.id),
							),
						),
						columns: { assignmentType: true, employeeId: true, teamId: true },
					}),
				)
			: [];

		const teamIdsToLoad = new Set<string>([
			...manageableTeamIds,
			...projectAssignments
				.map((assignment) => assignment.teamId)
				.filter((teamId): teamId is string => Boolean(teamId)),
		]);

		const [teamEmployees, locationRows, subareaRows] = yield* Effect.all([
			teamIdsToLoad.size
				? dbService.query("calendar.scope.teamEmployees", () =>
						db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, organizationId),
								eq(employee.isActive, true),
								inArray(employee.teamId, [...teamIdsToLoad]),
							),
							columns: { id: true },
						}),
					)
				: Effect.succeed([]),
			manageableLocationIds.length
				? dbService.query("calendar.scope.locationEmployees", () =>
						db.query.locationEmployee.findMany({
							where: inArray(locationEmployee.locationId, manageableLocationIds),
							columns: { employeeId: true },
						}),
					)
				: Effect.succeed([]),
			manageableSubareaIds.length
				? dbService.query("calendar.scope.subareaEmployees", () =>
						db.query.subareaEmployee.findMany({
							where: inArray(subareaEmployee.subareaId, manageableSubareaIds),
							columns: { employeeId: true },
						}),
					)
				: Effect.succeed([]),
		]);

		return new Set<string>([
			...teamEmployees.map((employeeRecord) => employeeRecord.id),
			...locationRows.map((assignment) => assignment.employeeId),
			...subareaRows.map((assignment) => assignment.employeeId),
			...projectAssignments
				.map((assignment) => assignment.employeeId)
				.filter((employeeId): employeeId is string => Boolean(employeeId)),
		]);
	});
}

function relevantCalendarConnections(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const scopedEmployeeIds = yield* scopedCalendarEmployeeIds(actor, organizationId);
		const providerLabels = new Map(
			getSupportedProviders().map((provider) => [provider.provider, provider.displayName] as const),
		);
		const dbService = yield* DatabaseService;
		const connections = yield* dbService.query("calendar.connections", () =>
			dbService.db.query.calendarConnection.findMany({
				where: eq(calendarConnection.organizationId, organizationId),
				with: {
					employee: {
						columns: { id: true },
						with: {
							user: { columns: { firstName: true, lastName: true, name: true, email: true } },
						},
					},
				},
			}),
		);

		const typedConnections = connections as unknown as CalendarConnectionWithEmployee[];

		return typedConnections
			.flatMap((connection) =>
				scopedEmployeeIds === null || scopedEmployeeIds.has(connection.employeeId)
					? [
							{
								id: connection.id,
								employeeId: connection.employeeId,
								employeeName: connection.employee?.user
									? buildAuthUserDisplayName(connection.employee.user) ||
										connection.providerAccountId
									: connection.providerAccountId,
								provider: connection.provider,
								providerLabel: providerLabels.get(connection.provider) ?? connection.provider,
								providerAccountId: connection.providerAccountId,
								calendarId: connection.calendarId,
								pushEnabled: connection.pushEnabled,
								conflictDetectionEnabled: connection.conflictDetectionEnabled,
								lastSyncAt: connection.lastSyncAt,
								lastSyncError: connection.lastSyncError,
								isActive: connection.isActive,
								createdAt: connection.createdAt,
							} satisfies CalendarConnectionSummary,
						]
					: [],
			)
			.sort((left, right) => {
				const nameComparison = left.employeeName.localeCompare(right.employeeName);
				if (nameComparison !== 0) {
					return nameComparison;
				}

				return left.providerLabel.localeCompare(right.providerLabel);
			});
	});
}

// ============================================
// GET SETTINGS
// ============================================

export const getCalendarSettings = organizationAction(
	{ name: "calendar.getSettings", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [settings, relevantConnections] = yield* Effect.all([
				dbService.query("calendar.getSettings", () =>
					dbService.db.query.organizationCalendarSettings.findFirst({
						where: eq(organizationCalendarSettings.organizationId, organizationId),
					}),
				),
				relevantCalendarConnections(actor, organizationId),
			]);

			return {
				googleEnabled: settings?.googleEnabled ?? true,
				microsoft365Enabled: settings?.microsoft365Enabled ?? true,
				icsFeedsEnabled: settings?.icsFeedsEnabled ?? true,
				teamIcsFeedsEnabled: settings?.teamIcsFeedsEnabled ?? true,
				autoSyncOnApproval: settings?.autoSyncOnApproval ?? true,
				conflictDetectionRequired: settings?.conflictDetectionRequired ?? false,
				eventTitleTemplate: settings?.eventTitleTemplate ?? "Out of Office - {categoryName}",
				eventDescriptionTemplate: settings?.eventDescriptionTemplate ?? null,
				// Provider availability from env config
				googleAvailable: isProviderSupported("google"),
				microsoft365Available: isProviderSupported("microsoft365"),
				relevantConnections,
			} satisfies CalendarSettings;
		}),
);

/** The calendar connections of the employees a scoped manager manages. */
export const getManagerCalendarReadView = organizationAction(
	{ name: "calendar.getManagerReadView", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const relevantConnections = yield* relevantCalendarConnections(actor, organizationId);
			return { relevantConnections } satisfies ManagerCalendarReadView;
		}),
);

// ============================================
// UPDATE SETTINGS
// ============================================

export const updateCalendarSettings = organizationAction(
	{ name: "calendar.updateSettings", requires: "orgAdmin", schema: calendarSettingsSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const settings = {
				googleEnabled: input.googleEnabled,
				microsoft365Enabled: input.microsoft365Enabled,
				icsFeedsEnabled: input.icsFeedsEnabled,
				teamIcsFeedsEnabled: input.teamIcsFeedsEnabled,
				autoSyncOnApproval: input.autoSyncOnApproval,
				conflictDetectionRequired: input.conflictDetectionRequired,
				eventTitleTemplate: input.eventTitleTemplate,
				eventDescriptionTemplate: input.eventDescriptionTemplate,
			};
			yield* dbService.query("calendar.upsertSettings", async () => {
				await dbService.db
					.insert(organizationCalendarSettings)
					.values({ organizationId, ...settings })
					.onConflictDoUpdate({
						target: organizationCalendarSettings.organizationId,
						set: { ...settings, updatedAt: new Date() },
					});
			});
		}),
);

// ============================================
// GET PROVIDER STATUS
// ============================================

export const getProviderStatus = organizationAction(
	{ name: "calendar.getProviderStatus", requires: "member", schema: noInput },
	() =>
		Effect.sync(() =>
			getSupportedProviders().map((p) => ({
				provider: p.provider,
				displayName: p.displayName,
				available: p.enabled,
				enabled: p.enabled,
			})),
		),
);
