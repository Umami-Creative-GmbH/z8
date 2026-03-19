"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import * as authSchema from "@/db/auth-schema";
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
import { AuthorizationError, DatabaseError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getSupportedProviders, isProviderSupported } from "@/lib/calendar-sync/providers";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";

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

export interface ManagerCalendarReadView {
	relevantConnections: CalendarConnectionSummary[];
}

const calendarSettingsSchema = z.object({
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

type CalendarSettingsActor = {
	session: { user: { id: string }; session: { activeOrganizationId: string | null } };
	dbService: {
		db: typeof import("@/db").db;
		query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, DatabaseError, never>;
	};
	organizationId: string;
	accessTier: SettingsAccessTier;
	currentEmployee: typeof employee.$inferSelect | null;
};

function calendarAuthorizationError(
	actor: { session: { user: { id: string } } },
	options: {
		message: string;
		action: string;
	},
) {
	return new AuthorizationError({
		message: options.message,
		userId: actor.session.user.id,
		resource: "calendar_settings",
		action: options.action,
	});
}

function getCalendarSettingsActorContext(queryName = "getCalendarSettingsActor") {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No active organization",
						userId: session.user.id,
						resource: "calendar_settings",
						action: "access",
					}),
				),
			);
		}

		const [membershipRecord, employeeRecord] = yield* _(
			Effect.all([
				dbService.query(`${queryName}:membership`, async () => {
					return dbService.db.query.member.findFirst({
						where: and(
							eq(authSchema.member.userId, session.user.id),
							eq(authSchema.member.organizationId, organizationId),
						),
						columns: { role: true },
					});
				}),
				dbService.query(`${queryName}:employee`, async () => {
					return dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
					});
				}),
			]),
		);

		const accessTier = resolveSettingsAccessTier({
			activeOrganizationId: organizationId,
			membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role)
				? membershipRecord.role
				: null,
			employeeRole: employeeRecord?.role ?? null,
		});

		if (accessTier === "member") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to calendar settings",
						userId: session.user.id,
						resource: "calendar_settings",
						action: "access",
					}),
				),
			);
		}

		return {
			session,
			dbService,
			organizationId,
			accessTier,
			currentEmployee: employeeRecord ?? null,
		} satisfies CalendarSettingsActor;
	});
}

function requireOrgAdminCalendarSettingsAccess(actor: CalendarSettingsActor, action: string) {
	if (actor.accessTier === "orgAdmin") {
		return Effect.void;
	}

	return Effect.fail(
		calendarAuthorizationError(actor, {
			message: `Only org admins can ${action} calendar settings`,
			action,
		}),
	);
}

function getScopedCalendarEmployeeIds(actor: CalendarSettingsActor, queryName: string) {
	return Effect.gen(function* (_) {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		if (!actor.currentEmployee) {
			return new Set<string>();
		}

		const currentEmployee = actor.currentEmployee;

		const [teamPermissionRows, managerLocationRows, managerSubareaRows, managedProjectRows] = yield* _(
			Effect.all([
				actor.dbService.query(`${queryName}:teamPermissions`, async () => {
					return actor.dbService.db.query.teamPermissions.findMany({
						where: and(
							eq(teamPermissions.employeeId, currentEmployee.id),
							eq(teamPermissions.organizationId, actor.organizationId),
						),
						columns: { teamId: true, canManageTeamSettings: true },
					});
				}),
				actor.dbService.query(`${queryName}:managerLocations`, async () => {
					return actor.dbService.db.query.locationEmployee.findMany({
						where: eq(locationEmployee.employeeId, currentEmployee.id),
						columns: { locationId: true },
					});
				}),
				actor.dbService.query(`${queryName}:managerSubareas`, async () => {
					return actor.dbService.db.query.subareaEmployee.findMany({
						where: eq(subareaEmployee.employeeId, currentEmployee.id),
						columns: { subareaId: true },
					});
				}),
				actor.dbService.query(`${queryName}:managedProjects`, async () => {
					return actor.dbService.db.query.projectManager.findMany({
						where: eq(projectManager.employeeId, currentEmployee.id),
						columns: { projectId: true },
					});
				}),
			]),
		);

		const manageableTeamIds = new Set(
			teamPermissionRows
				.filter((permission) => permission.canManageTeamSettings && permission.teamId)
				.map((permission) => permission.teamId as string),
		);
		const manageableLocationIds = managerLocationRows
			.map((assignment) => assignment.locationId)
			.filter((locationId): locationId is string => Boolean(locationId));
		const manageableSubareaIds = managerSubareaRows
			.map((assignment) => assignment.subareaId)
			.filter((subareaId): subareaId is string => Boolean(subareaId));
		const rawManagedProjectIds = managedProjectRows.map((assignment) => assignment.projectId);
		const managedProjectIds = rawManagedProjectIds.length
			? yield* _(
					actor.dbService.query(`${queryName}:scopedProjects`, async () => {
						return actor.dbService.db.query.project.findMany({
							where: and(
								eq(project.organizationId, actor.organizationId),
								inArray(project.id, rawManagedProjectIds),
							),
							columns: { id: true },
						});
					}),
				)
			: [];

		const projectAssignments = managedProjectIds.length
			? yield* _(
					actor.dbService.query(`${queryName}:projectAssignments`, async () => {
						return actor.dbService.db.query.projectAssignment.findMany({
							where: and(
								eq(projectAssignment.organizationId, actor.organizationId),
								inArray(
									projectAssignment.projectId,
									managedProjectIds.map((managedProject) => managedProject.id),
								),
							),
							columns: { assignmentType: true, employeeId: true, teamId: true },
						});
					}),
				)
			: [];

		const teamIdsToLoad = new Set<string>([
			...manageableTeamIds,
			...projectAssignments
				.map((assignment) => assignment.teamId)
				.filter((teamId): teamId is string => Boolean(teamId)),
		]);

		const [teamEmployees, locationRows, subareaRows] = yield* _(
			Effect.all([
				teamIdsToLoad.size
					? actor.dbService.query(`${queryName}:teamEmployees`, async () => {
						return actor.dbService.db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, actor.organizationId),
								eq(employee.isActive, true),
								inArray(employee.teamId, [...teamIdsToLoad]),
							),
							columns: { id: true },
						});
					})
					: Effect.succeed([]),
				manageableLocationIds.length
					? actor.dbService.query(`${queryName}:locationEmployees`, async () => {
						return actor.dbService.db.query.locationEmployee.findMany({
							where: inArray(locationEmployee.locationId, manageableLocationIds),
							columns: { employeeId: true },
						});
					})
					: Effect.succeed([]),
				manageableSubareaIds.length
					? actor.dbService.query(`${queryName}:subareaEmployees`, async () => {
						return actor.dbService.db.query.subareaEmployee.findMany({
							where: inArray(subareaEmployee.subareaId, manageableSubareaIds),
							columns: { employeeId: true },
						});
					})
					: Effect.succeed([]),
			]),
		);

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

function getRelevantCalendarConnections(actor: CalendarSettingsActor, queryName: string) {
	return Effect.gen(function* (_) {
		const scopedEmployeeIds = yield* _(getScopedCalendarEmployeeIds(actor, `${queryName}:scope`));
		const providerLabels = new Map(
			getSupportedProviders().map((provider) => [provider.provider, provider.displayName] as const),
		);
		const connections = yield* _(
			actor.dbService.query(`${queryName}:connections`, async () => {
				return actor.dbService.db.query.calendarConnection.findMany({
					where: eq(calendarConnection.organizationId, actor.organizationId),
					with: {
						employee: {
							columns: { id: true, firstName: true, lastName: true },
						},
					},
				});
			}),
		);

		return connections
			.filter((connection) => scopedEmployeeIds === null || scopedEmployeeIds.has(connection.employeeId))
			.map((connection) => ({
				id: connection.id,
				employeeId: connection.employeeId,
				employeeName:
					[connection.employee?.firstName, connection.employee?.lastName].filter(Boolean).join(" ") ||
					connection.providerAccountId,
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
			}))
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

export async function getCalendarSettings(): Promise<ServerActionResult<CalendarSettings>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getCalendarSettingsActorContext("getCalendarSettings"));
		yield* _(requireOrgAdminCalendarSettingsAccess(actor, "read"));
		const [settings, relevantConnections] = yield* _(
			Effect.all([
				actor.dbService.query("getCalendarSettings:settings", async () => {
					return actor.dbService.db.query.organizationCalendarSettings.findFirst({
						where: eq(organizationCalendarSettings.organizationId, actor.organizationId),
					});
				}),
				getRelevantCalendarConnections(actor, "getCalendarSettings"),
			]),
		);

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
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getManagerCalendarReadView(): Promise<ServerActionResult<ManagerCalendarReadView>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getCalendarSettingsActorContext("getManagerCalendarReadView"));
		const relevantConnections = yield* _(
			getRelevantCalendarConnections(actor, "getManagerCalendarReadView"),
		);

		return {
			relevantConnections,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE SETTINGS
// ============================================

export async function updateCalendarSettings(
	data: CalendarSettingsFormValues,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getCalendarSettingsActorContext("updateCalendarSettings"));
		yield* _(requireOrgAdminCalendarSettingsAccess(actor, "update"));

		// Validate input
		const result = calendarSettingsSchema.safeParse(data);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error.issues[0]?.message || "Invalid settings",
						field: "settings",
					}),
				),
			);
		}

		const validated = result.data;

		// Upsert settings
		yield* _(
			actor.dbService.query("upsertCalendarSettings", async () => {
				await actor.dbService.db
					.insert(organizationCalendarSettings)
					.values({
						organizationId: actor.organizationId,
						googleEnabled: validated.googleEnabled,
						microsoft365Enabled: validated.microsoft365Enabled,
						icsFeedsEnabled: validated.icsFeedsEnabled,
						teamIcsFeedsEnabled: validated.teamIcsFeedsEnabled,
						autoSyncOnApproval: validated.autoSyncOnApproval,
						conflictDetectionRequired: validated.conflictDetectionRequired,
						eventTitleTemplate: validated.eventTitleTemplate,
						eventDescriptionTemplate: validated.eventDescriptionTemplate,
					})
					.onConflictDoUpdate({
						target: organizationCalendarSettings.organizationId,
						set: {
							googleEnabled: validated.googleEnabled,
							microsoft365Enabled: validated.microsoft365Enabled,
							icsFeedsEnabled: validated.icsFeedsEnabled,
							teamIcsFeedsEnabled: validated.teamIcsFeedsEnabled,
							autoSyncOnApproval: validated.autoSyncOnApproval,
							conflictDetectionRequired: validated.conflictDetectionRequired,
							eventTitleTemplate: validated.eventTitleTemplate,
							eventDescriptionTemplate: validated.eventDescriptionTemplate,
							updatedAt: new Date(),
						},
					});
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// GET PROVIDER STATUS
// ============================================

export async function getProviderStatus(): Promise<
	ServerActionResult<
		Array<{
			provider: string;
			displayName: string;
			available: boolean;
			enabled: boolean;
		}>
	>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const providers = getSupportedProviders();

		return providers.map((p) => ({
			provider: p.provider,
			displayName: p.displayName,
			available: p.enabled,
			enabled: p.enabled,
		}));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
