"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { organizationCalendarSettings } from "@/db/schema";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getSupportedProviders, isProviderSupported } from "@/lib/calendar-sync/providers";

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

// ============================================
// GET SETTINGS
// ============================================

export async function getCalendarSettings(): Promise<ServerActionResult<CalendarSettings>> {
	const effect = Effect.gen(function* (_) {
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
						action: "read",
					}),
				),
			);
		}

		// Check if user is admin/owner
		const member = yield* _(
			dbService.query("getMember", async () => {
				return dbService.db.query.member.findFirst({
					where: and(
						eq(authSchema.member.userId, session.user.id),
						eq(authSchema.member.organizationId, organizationId),
					),
				});
			}),
		);

		if (!member || (member.role !== "owner" && member.role !== "admin")) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only admins can access calendar settings",
						userId: session.user.id,
						resource: "calendar_settings",
						action: "read",
					}),
				),
			);
		}

		// Get existing settings or return defaults
		const settings = yield* _(
			dbService.query("getCalendarSettings", async () => {
				return dbService.db.query.organizationCalendarSettings.findFirst({
					where: eq(organizationCalendarSettings.organizationId, organizationId),
				});
			}),
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
						action: "update",
					}),
				),
			);
		}

		// Check if user is admin/owner
		const member = yield* _(
			dbService.query("getMember", async () => {
				return dbService.db.query.member.findFirst({
					where: and(
						eq(authSchema.member.userId, session.user.id),
						eq(authSchema.member.organizationId, organizationId),
					),
				});
			}),
		);

		if (!member || (member.role !== "owner" && member.role !== "admin")) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only admins can update calendar settings",
						userId: session.user.id,
						resource: "calendar_settings",
						action: "update",
					}),
				),
			);
		}

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
			dbService.query("upsertCalendarSettings", async () => {
				await dbService.db
					.insert(organizationCalendarSettings)
					.values({
						organizationId,
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
