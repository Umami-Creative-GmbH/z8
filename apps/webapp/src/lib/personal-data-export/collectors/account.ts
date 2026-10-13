/**
 * Account category of a personal data export (#811). Account data belongs to
 * the person's login rather than to one organization, so every
 * organization's export repeats it.
 *
 * - **Admin export** (#1166): only the name and email linked to the employee.
 *   Nothing else about the login (sessions, sign-in methods, security
 *   settings, preferences, devices) ever goes into it.
 * - **Employee export** (#1171): the `user` record with its account fields,
 *   plus sessions, sign-in methods, passkeys, trusted devices, settings,
 *   notification preferences, water intake and hydration stats, push devices
 *   and access violations. Rows an organization records about the login
 *   (session details, trusted devices, access violations) come only from the
 *   exported organization.
 *
 * Never exported: password hashes; session, OAuth and ID tokens; 2FA secrets
 * and backup codes; passkey keys and credential ids; push endpoints and keys;
 * native push tokens; device fingerprints; MDM device ids; pending invite
 * codes; which organization a session had open; who impersonated a session
 * (only that it was); SCIM state.
 */

import { and, asc, eq } from "drizzle-orm";
// 2FA status is `user.two_factor_enabled`; the `two_factor` table holds only secrets.
import { account, passkey, session, user } from "@/db/auth-schema";
import {
	accessViolationLog,
	employee,
	hydrationStats,
	notificationPreference,
	pushDeviceToken,
	pushSubscription,
	sessionExtension,
	trustedDevice,
	userSettings,
	waterIntakeLog,
} from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataPart,
	recordPart,
	tablePart,
} from "../collector";
import { instantText, jsonText, PersonalDataSubjectNotFoundError, userNameLookup } from "../values";
import { accountFieldGuide } from "./account-fields";

const SESSION_COLUMNS = [
	"created_at",
	"updated_at",
	"expires_at",
	"ip_address",
	"user_agent",
	"impersonated",
	"country",
	"region",
	"city",
	"mfa_method",
	"mfa_verified_at",
	"last_activity_at",
] as const;

const SIGN_IN_METHOD_COLUMNS = [
	"provider",
	"account_id",
	"password_set",
	"created_at",
	"updated_at",
] as const;

const PASSKEY_COLUMNS = [
	"name",
	"device_type",
	"backed_up",
	"transports",
	"aaguid",
	"created_at",
] as const;

const TRUSTED_DEVICE_COLUMNS = [
	"device_name",
	"platform",
	"user_agent",
	"trust_source",
	"is_active",
	"expires_at",
	"last_used_at",
	"last_ip_address",
	"mdm_provider",
	"mdm_compliant",
	"created_at",
	"created_by",
	"revoked_at",
	"revoked_by",
	"revoke_reason",
] as const;

const NOTIFICATION_PREFERENCE_COLUMNS = [
	"notification_type",
	"channel",
	"enabled",
	"created_at",
	"updated_at",
] as const;

const WATER_INTAKE_COLUMNS = ["logged_at", "amount", "source", "created_at"] as const;

const PUSH_DEVICE_COLUMNS = [
	"kind",
	"platform",
	"device_name",
	"user_agent",
	"is_active",
	"created_at",
	"last_used_at",
	"last_seen_at",
] as const;

const ACCESS_VIOLATION_COLUMNS = [
	"violation_type",
	"action_taken",
	"ip_address",
	"country",
	"user_agent",
	"request_path",
	"request_method",
	"reason",
	"blocked_ip",
	"blocked_country",
	"required_mfa_type",
	"concurrent_session_count",
	"created_at",
] as const;

export const accountCollector: PersonalDataCollector = {
	category: "account",
	collect: collectAccount,
	fields: accountFieldGuide,
};

async function collectAccount(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	// The login linked to this organization's employee record, never another one.
	const [linked] = await database
		.select({ user })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.limit(1);
	if (!linked) throw new PersonalDataSubjectNotFoundError();
	const login = linked.user;

	const nameAndEmail = {
		name: login.name,
		first_name: login.firstName,
		last_name: login.lastName,
		email: login.email,
	};
	if (scope.kind === "admin") {
		return { category: "account", parts: [recordPart("user", nameAndEmail)] };
	}
	return {
		category: "account",
		parts: [
			recordPart("user", {
				...nameAndEmail,
				email_verified: login.emailVerified,
				image: login.image,
				two_factor_enabled: login.twoFactorEnabled ?? false,
				can_create_organizations: login.canCreateOrganizations ?? false,
				role: login.role,
				banned: login.banned ?? false,
				ban_reason: login.banReason,
				ban_expires: instantText(login.banExpires),
				created_at: instantText(login.createdAt),
				updated_at: instantText(login.updatedAt),
			}),
			...(await collectEmployeeOnlyAccountParts(database, login.id, scope.organizationId)),
		],
	};
}

/**
 * The account data only the employee export holds: sessions, sign-in
 * providers, passkeys, trusted devices, settings, notification preferences,
 * wellness logs, push devices and access violations (#1171).
 */
async function collectEmployeeOnlyAccountParts(
	database: PersonalDataExportDatabase,
	userId: string,
	organizationId: string,
): Promise<PersonalDataPart[]> {
	const [
		sessions,
		methods,
		passkeys,
		devices,
		[settings],
		preferences,
		water,
		[hydration],
		webPush,
		nativePush,
		violations,
	] = await Promise.all([
		database
			.select({ session, extension: sessionExtension })
			.from(session)
			.leftJoin(
				sessionExtension,
				and(
					eq(sessionExtension.sessionId, session.id),
					eq(sessionExtension.organizationId, organizationId),
				),
			)
			.where(eq(session.userId, userId))
			.orderBy(asc(session.createdAt), asc(session.id)),
		database
			.select()
			.from(account)
			.where(eq(account.userId, userId))
			.orderBy(asc(account.createdAt), asc(account.id)),
		database
			.select()
			.from(passkey)
			.where(eq(passkey.userId, userId))
			.orderBy(asc(passkey.createdAt), asc(passkey.id)),
		database
			.select()
			.from(trustedDevice)
			.where(
				and(eq(trustedDevice.userId, userId), eq(trustedDevice.organizationId, organizationId)),
			)
			.orderBy(asc(trustedDevice.createdAt), asc(trustedDevice.id)),
		database.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
		// User-level preferences; the legacy organization column is not a scope.
		database
			.select()
			.from(notificationPreference)
			.where(eq(notificationPreference.userId, userId))
			.orderBy(
				asc(notificationPreference.createdAt),
				asc(notificationPreference.notificationType),
				asc(notificationPreference.channel),
				asc(notificationPreference.id),
			),
		database
			.select()
			.from(waterIntakeLog)
			.where(eq(waterIntakeLog.userId, userId))
			.orderBy(asc(waterIntakeLog.loggedAt), asc(waterIntakeLog.id)),
		database.select().from(hydrationStats).where(eq(hydrationStats.userId, userId)).limit(1),
		database
			.select()
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, userId))
			.orderBy(asc(pushSubscription.createdAt), asc(pushSubscription.id)),
		database
			.select()
			.from(pushDeviceToken)
			.where(eq(pushDeviceToken.userId, userId))
			.orderBy(asc(pushDeviceToken.createdAt), asc(pushDeviceToken.id)),
		database
			.select()
			.from(accessViolationLog)
			.where(
				and(
					eq(accessViolationLog.userId, userId),
					eq(accessViolationLog.organizationId, organizationId),
				),
			)
			.orderBy(asc(accessViolationLog.createdAt), asc(accessViolationLog.id)),
	]);
	const deviceActor = await userNameLookup(
		database,
		devices.flatMap((device) => [device.createdBy, device.revokedBy]),
	);
	return [
		tablePart(
			"sessions",
			SESSION_COLUMNS,
			sessions.map(({ session: row, extension }) => {
				// An impersonated session's network details are the impersonator's, not the employee's.
				const impersonated = row.impersonatedBy !== null;
				return {
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
					expires_at: instantText(row.expiresAt),
					ip_address: impersonated ? null : row.ipAddress,
					user_agent: impersonated ? null : row.userAgent,
					impersonated,
					country: impersonated ? null : (extension?.country ?? null),
					region: impersonated ? null : (extension?.region ?? null),
					city: impersonated ? null : (extension?.city ?? null),
					mfa_method: extension?.mfaMethod ?? null,
					mfa_verified_at: instantText(extension?.mfaVerifiedAt),
					last_activity_at: instantText(extension?.lastActivityAt),
				};
			}),
		),
		tablePart(
			"sign_in_methods",
			SIGN_IN_METHOD_COLUMNS,
			methods.map((row) => ({
				provider: row.providerId,
				account_id: row.accountId,
				password_set: row.providerId === "credential" && row.password !== null,
				created_at: instantText(row.createdAt),
				updated_at: instantText(row.updatedAt),
			})),
		),
		tablePart(
			"passkeys",
			PASSKEY_COLUMNS,
			passkeys.map((row) => ({
				name: row.name,
				device_type: row.deviceType,
				backed_up: row.backedUp,
				transports: row.transports,
				aaguid: row.aaguid,
				created_at: instantText(row.createdAt),
			})),
		),
		tablePart(
			"trusted_devices",
			TRUSTED_DEVICE_COLUMNS,
			devices.map((row) => ({
				device_name: row.deviceName,
				platform: row.platform,
				user_agent: row.userAgent,
				trust_source: row.trustSource,
				is_active: row.isActive,
				expires_at: instantText(row.expiresAt),
				last_used_at: instantText(row.lastUsedAt),
				last_ip_address: row.lastIpAddress,
				mdm_provider: row.mdmProvider,
				mdm_compliant: row.mdmCompliant,
				created_at: instantText(row.createdAt),
				created_by: deviceActor(row.createdBy),
				revoked_at: instantText(row.revokedAt),
				revoked_by: deviceActor(row.revokedBy),
				revoke_reason: row.revokeReason,
			})),
		),
		recordPart(
			"settings",
			settings
				? {
						dashboard_widget_order: jsonText(settings.dashboardWidgetOrder),
						onboarding_complete: settings.onboardingComplete,
						onboarding_step: settings.onboardingStep,
						onboarding_started_at: instantText(settings.onboardingStartedAt),
						onboarding_completed_at: instantText(settings.onboardingCompletedAt),
						help_improve_product: settings.helpImproveProduct,
						water_reminder_enabled: settings.waterReminderEnabled,
						water_reminder_preset: settings.waterReminderPreset,
						water_reminder_interval_minutes: settings.waterReminderIntervalMinutes,
						water_reminder_daily_goal: settings.waterReminderDailyGoal,
						timezone: settings.timezone,
						week_start_day: settings.weekStartDay,
						time_format: settings.timeFormat,
						locale: settings.locale,
						created_at: instantText(settings.createdAt),
						updated_at: instantText(settings.updatedAt),
					}
				: null,
		),
		tablePart(
			"notification_preferences",
			NOTIFICATION_PREFERENCE_COLUMNS,
			preferences.map((row) => ({
				notification_type: row.notificationType,
				channel: row.channel,
				enabled: row.enabled,
				created_at: instantText(row.createdAt),
				updated_at: instantText(row.updatedAt),
			})),
		),
		tablePart(
			"water_intake",
			WATER_INTAKE_COLUMNS,
			water.map((row) => ({
				logged_at: instantText(row.loggedAt),
				amount: row.amount,
				source: row.source,
				created_at: instantText(row.createdAt),
			})),
		),
		recordPart(
			"hydration_stats",
			hydration
				? {
						current_streak: hydration.currentStreak,
						longest_streak: hydration.longestStreak,
						last_goal_met_date: hydration.lastGoalMetDate,
						total_intake_all_time: hydration.totalIntakeAllTime,
						snoozed_until: instantText(hydration.snoozedUntil),
						updated_at: instantText(hydration.updatedAt),
					}
				: null,
		),
		tablePart("push_devices", PUSH_DEVICE_COLUMNS, [
			...webPush.map((row) => ({
				kind: "web",
				platform: null,
				device_name: row.deviceName,
				user_agent: row.userAgent,
				is_active: row.isActive,
				created_at: instantText(row.createdAt),
				last_used_at: instantText(row.lastUsedAt),
				last_seen_at: null,
			})),
			...nativePush.map((row) => ({
				kind: "native",
				platform: row.platform,
				device_name: null,
				user_agent: null,
				is_active: row.isActive,
				created_at: instantText(row.createdAt),
				last_used_at: instantText(row.lastUsedAt),
				last_seen_at: instantText(row.lastSeenAt),
			})),
		]),
		tablePart(
			"access_violations",
			ACCESS_VIOLATION_COLUMNS,
			violations.map((row) => ({
				violation_type: row.violationType,
				action_taken: row.actionTaken,
				ip_address: row.ipAddress,
				country: row.country,
				user_agent: row.userAgent,
				request_path: row.requestPath,
				request_method: row.requestMethod,
				reason: row.metadata?.reason ?? null,
				blocked_ip: row.metadata?.blockedIp ?? null,
				blocked_country: row.metadata?.blockedCountry ?? null,
				required_mfa_type: row.metadata?.requiredMfaType ?? null,
				concurrent_session_count: row.metadata?.concurrentSessionCount ?? null,
				created_at: instantText(row.createdAt),
			})),
		),
	];
}
