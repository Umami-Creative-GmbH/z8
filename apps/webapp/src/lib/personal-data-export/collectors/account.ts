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
	commonFieldExplanations,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataFieldGuide,
	type PersonalDataPart,
	recordPart,
	tablePart,
} from "../collector";
import { instantText, loadUserNames, nameOf } from "../values";
import { PersonalDataSubjectNotFoundError } from "./employment";

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

/** The README's explanation of the account parts (see "Field guide" in `../collector.ts`). */
export const accountFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const userAgent = () =>
		t(
			"personalDataExport.readme.fields.account.shared.userAgent",
			"The browser or app, as it identified itself.",
		);
	const isActive = () =>
		t("personalDataExport.readme.fields.account.shared.isActive", "Whether it is still in use.");
	const lastUsedAt = () =>
		t("personalDataExport.readme.fields.account.shared.lastUsedAt", "When it was last used.");
	const ipAddress = () =>
		t("personalDataExport.readme.fields.account.shared.ipAddress", "The IP address it came from.");
	const country = () =>
		t(
			"personalDataExport.readme.fields.account.shared.country",
			"The country of that IP address (ISO code).",
		);

	return {
		user: {
			summary: t(
				"personalDataExport.readme.fields.account.user.summary",
				"Your user account: the login you use for this organization.",
			),
			fields: {
				...common("created_at", "updated_at"),
				name: t(
					"personalDataExport.readme.fields.account.user.name",
					"Your account's display name.",
				),
				first_name: t(
					"personalDataExport.readme.fields.account.user.firstName",
					"Your account's first name.",
				),
				last_name: t(
					"personalDataExport.readme.fields.account.user.lastName",
					"Your account's last name.",
				),
				email: t(
					"personalDataExport.readme.fields.account.user.email",
					"The email address you sign in with.",
				),
				email_verified: t(
					"personalDataExport.readme.fields.account.user.emailVerified",
					"Whether you confirmed that email address.",
				),
				image: t(
					"personalDataExport.readme.fields.account.user.image",
					"The address of your profile picture.",
				),
				two_factor_enabled: t(
					"personalDataExport.readme.fields.account.user.twoFactorEnabled",
					"Whether two-factor authentication is on.",
				),
				can_create_organizations: t(
					"personalDataExport.readme.fields.account.user.canCreateOrganizations",
					"Whether you may create organizations of your own.",
				),
				role: t(
					"personalDataExport.readme.fields.account.user.role",
					"Your role on the platform (not in this organization).",
				),
				banned: t(
					"personalDataExport.readme.fields.account.user.banned",
					"Whether the platform blocked your account.",
				),
				ban_reason: t(
					"personalDataExport.readme.fields.account.user.banReason",
					"Why the platform blocked it.",
				),
				ban_expires: t(
					"personalDataExport.readme.fields.account.user.banExpires",
					"When the block ends; empty if it does not end.",
				),
			},
		},
		sessions: {
			summary: t(
				"personalDataExport.readme.fields.account.sessions.summary",
				"Your sign-ins (sessions) that are still stored, with details this organization recorded about them.",
			),
			fields: {
				created_at: t(
					"personalDataExport.readme.fields.account.sessions.createdAt",
					"When you signed in.",
				),
				updated_at: t(
					"personalDataExport.readme.fields.account.sessions.updatedAt",
					"When the session was last renewed.",
				),
				expires_at: t(
					"personalDataExport.readme.fields.account.sessions.expiresAt",
					"When the session ends unless renewed.",
				),
				ip_address: ipAddress(),
				user_agent: userAgent(),
				impersonated: t(
					"personalDataExport.readme.fields.account.sessions.impersonated",
					"Whether platform support opened this session as you.",
				),
				country: country(),
				region: t(
					"personalDataExport.readme.fields.account.sessions.region",
					"The region of that IP address.",
				),
				city: t(
					"personalDataExport.readme.fields.account.sessions.city",
					"The city of that IP address.",
				),
				mfa_method: t(
					"personalDataExport.readme.fields.account.sessions.mfaMethod",
					"How you confirmed the second factor, if asked.",
				),
				mfa_verified_at: t(
					"personalDataExport.readme.fields.account.sessions.mfaVerifiedAt",
					"When you confirmed it.",
				),
				last_activity_at: t(
					"personalDataExport.readme.fields.account.sessions.lastActivityAt",
					"When you last used the session in this organization.",
				),
			},
		},
		sign_in_methods: {
			summary: t(
				"personalDataExport.readme.fields.account.signInMethods.summary",
				"The ways you can sign in: a password or linked accounts such as Google or Microsoft.",
			),
			fields: {
				...common("created_at", "updated_at"),
				provider: t(
					"personalDataExport.readme.fields.account.signInMethods.provider",
					"The sign-in method; credential means email and password.",
				),
				account_id: t(
					"personalDataExport.readme.fields.account.signInMethods.accountId",
					"Your account's ID at that provider.",
				),
				password_set: t(
					"personalDataExport.readme.fields.account.signInMethods.passwordSet",
					"Whether a password is set (the password itself is never exported).",
				),
			},
		},
		passkeys: {
			summary: t(
				"personalDataExport.readme.fields.account.passkeys.summary",
				"Your passkeys (keys are never exported).",
			),
			fields: {
				...common("created_at"),
				name: t("personalDataExport.readme.fields.account.passkeys.name", "The passkey's name."),
				device_type: t(
					"personalDataExport.readme.fields.account.passkeys.deviceType",
					"Whether it lives on one device or syncs across devices.",
				),
				backed_up: t(
					"personalDataExport.readme.fields.account.passkeys.backedUp",
					"Whether it is backed up.",
				),
				transports: t(
					"personalDataExport.readme.fields.account.passkeys.transports",
					"How the authenticator connects, e.g. usb or internal.",
				),
				aaguid: t(
					"personalDataExport.readme.fields.account.passkeys.aaguid",
					"The authenticator model's ID.",
				),
			},
		},
		trusted_devices: {
			summary: t(
				"personalDataExport.readme.fields.account.trustedDevices.summary",
				"Devices this organization trusts for your sign-ins.",
			),
			fields: {
				...common("created_at", "created_by"),
				device_name: t(
					"personalDataExport.readme.fields.account.trustedDevices.deviceName",
					"The device's name.",
				),
				platform: t(
					"personalDataExport.readme.fields.account.trustedDevices.platform",
					"The operating system.",
				),
				user_agent: userAgent(),
				trust_source: t(
					"personalDataExport.readme.fields.account.trustedDevices.trustSource",
					"Why it is trusted: a passkey, an administrator, your choice to remember it, or device management (MDM).",
				),
				is_active: isActive(),
				expires_at: t(
					"personalDataExport.readme.fields.account.trustedDevices.expiresAt",
					"When the trust ends.",
				),
				last_used_at: lastUsedAt(),
				last_ip_address: t(
					"personalDataExport.readme.fields.account.trustedDevices.lastIpAddress",
					"The IP address of its last use.",
				),
				mdm_provider: t(
					"personalDataExport.readme.fields.account.trustedDevices.mdmProvider",
					"The device management system, if any.",
				),
				mdm_compliant: t(
					"personalDataExport.readme.fields.account.trustedDevices.mdmCompliant",
					"Whether the device management system reported it compliant.",
				),
				revoked_at: t(
					"personalDataExport.readme.fields.account.trustedDevices.revokedAt",
					"When the trust was withdrawn.",
				),
				revoked_by: t(
					"personalDataExport.readme.fields.account.trustedDevices.revokedBy",
					"Who withdrew it.",
				),
				revoke_reason: t(
					"personalDataExport.readme.fields.account.trustedDevices.revokeReason",
					"Why it was withdrawn.",
				),
			},
		},
		settings: {
			summary: t(
				"personalDataExport.readme.fields.account.settings.summary",
				"Your personal settings in the app.",
			),
			fields: {
				...common("created_at", "updated_at"),
				dashboard_widget_order: t(
					"personalDataExport.readme.fields.account.settings.dashboardWidgetOrder",
					"How you arranged your dashboard, as JSON.",
				),
				onboarding_complete: t(
					"personalDataExport.readme.fields.account.settings.onboardingComplete",
					"Whether you finished the introduction.",
				),
				onboarding_step: t(
					"personalDataExport.readme.fields.account.settings.onboardingStep",
					"The introduction step you reached.",
				),
				onboarding_started_at: t(
					"personalDataExport.readme.fields.account.settings.onboardingStartedAt",
					"When you started the introduction.",
				),
				onboarding_completed_at: t(
					"personalDataExport.readme.fields.account.settings.onboardingCompletedAt",
					"When you finished it.",
				),
				help_improve_product: t(
					"personalDataExport.readme.fields.account.settings.helpImproveProduct",
					"Whether you agreed to help improve the product.",
				),
				water_reminder_enabled: t(
					"personalDataExport.readme.fields.account.settings.waterReminderEnabled",
					"Whether water reminders are on.",
				),
				water_reminder_preset: t(
					"personalDataExport.readme.fields.account.settings.waterReminderPreset",
					"The water reminder preset you chose.",
				),
				water_reminder_interval_minutes: t(
					"personalDataExport.readme.fields.account.settings.waterReminderIntervalMinutes",
					"Minutes between water reminders.",
				),
				water_reminder_daily_goal: t(
					"personalDataExport.readme.fields.account.settings.waterReminderDailyGoal",
					"Your daily goal in glasses.",
				),
				timezone: t(
					"personalDataExport.readme.fields.account.settings.timezone",
					"The time zone you chose for showing times.",
				),
				week_start_day: t(
					"personalDataExport.readme.fields.account.settings.weekStartDay",
					"The day your week starts on.",
				),
				time_format: t(
					"personalDataExport.readme.fields.account.settings.timeFormat",
					"Whether times show in 12- or 24-hour format.",
				),
				locale: t(
					"personalDataExport.readme.fields.account.settings.locale",
					"Your app language; empty means it follows your browser.",
				),
			},
		},
		notification_preferences: {
			summary: t(
				"personalDataExport.readme.fields.account.notificationPreferences.summary",
				"Which notifications you turned on or off, per channel.",
			),
			fields: {
				...common("created_at", "updated_at"),
				notification_type: t(
					"personalDataExport.readme.fields.account.notificationPreferences.notificationType",
					"The kind of notification.",
				),
				channel: t(
					"personalDataExport.readme.fields.account.notificationPreferences.channel",
					"Where it is delivered, e.g. email or push.",
				),
				enabled: t(
					"personalDataExport.readme.fields.account.notificationPreferences.enabled",
					"Whether you receive it there.",
				),
			},
		},
		water_intake: {
			summary: t(
				"personalDataExport.readme.fields.account.waterIntake.summary",
				"The water you logged.",
			),
			fields: {
				...common("created_at"),
				logged_at: t(
					"personalDataExport.readme.fields.account.waterIntake.loggedAt",
					"When you drank it.",
				),
				amount: t(
					"personalDataExport.readme.fields.account.waterIntake.amount",
					"How many glasses.",
				),
				source: t(
					"personalDataExport.readme.fields.account.waterIntake.source",
					"Where you logged it: a reminder, by hand, or the widget.",
				),
			},
		},
		hydration_stats: {
			summary: t(
				"personalDataExport.readme.fields.account.hydrationStats.summary",
				"Your water intake totals and streaks.",
			),
			fields: {
				...common("updated_at"),
				current_streak: t(
					"personalDataExport.readme.fields.account.hydrationStats.currentStreak",
					"Days in a row you reached your goal, up to now.",
				),
				longest_streak: t(
					"personalDataExport.readme.fields.account.hydrationStats.longestStreak",
					"Your longest streak.",
				),
				last_goal_met_date: t(
					"personalDataExport.readme.fields.account.hydrationStats.lastGoalMetDate",
					"The last day you reached your goal.",
				),
				total_intake_all_time: t(
					"personalDataExport.readme.fields.account.hydrationStats.totalIntakeAllTime",
					"All glasses you logged.",
				),
				snoozed_until: t(
					"personalDataExport.readme.fields.account.hydrationStats.snoozedUntil",
					"Until when you paused reminders.",
				),
			},
		},
		push_devices: {
			summary: t(
				"personalDataExport.readme.fields.account.pushDevices.summary",
				"Browsers and devices that receive push notifications (their keys are never exported).",
			),
			fields: {
				...common("created_at"),
				kind: t(
					"personalDataExport.readme.fields.account.pushDevices.kind",
					"web for a browser, native for the mobile app.",
				),
				platform: t(
					"personalDataExport.readme.fields.account.pushDevices.platform",
					"The mobile platform (ios or android); empty for a browser.",
				),
				device_name: t(
					"personalDataExport.readme.fields.account.pushDevices.deviceName",
					"The device's name.",
				),
				user_agent: userAgent(),
				is_active: isActive(),
				last_used_at: lastUsedAt(),
				last_seen_at: t(
					"personalDataExport.readme.fields.account.pushDevices.lastSeenAt",
					"When the app last registered the device.",
				),
			},
		},
		access_violations: {
			summary: t(
				"personalDataExport.readme.fields.account.accessViolations.summary",
				"Requests this organization's access rules blocked, challenged or flagged.",
			),
			fields: {
				...common("created_at"),
				violation_type: t(
					"personalDataExport.readme.fields.account.accessViolations.violationType",
					"Which rule it broke, e.g. ip_blocked.",
				),
				action_taken: t(
					"personalDataExport.readme.fields.account.accessViolations.actionTaken",
					"What happened: blocked, challenged or logged.",
				),
				ip_address: ipAddress(),
				country: country(),
				user_agent: userAgent(),
				request_path: t(
					"personalDataExport.readme.fields.account.accessViolations.requestPath",
					"The page or address requested.",
				),
				request_method: t(
					"personalDataExport.readme.fields.account.accessViolations.requestMethod",
					"The kind of request, e.g. GET.",
				),
				reason: t(
					"personalDataExport.readme.fields.account.accessViolations.reason",
					"The reason recorded.",
				),
				blocked_ip: t(
					"personalDataExport.readme.fields.account.accessViolations.blockedIp",
					"The blocked IP address.",
				),
				blocked_country: t(
					"personalDataExport.readme.fields.account.accessViolations.blockedCountry",
					"The blocked country.",
				),
				required_mfa_type: t(
					"personalDataExport.readme.fields.account.accessViolations.requiredMfaType",
					"The second factor the rule required.",
				),
				concurrent_session_count: t(
					"personalDataExport.readme.fields.account.accessViolations.concurrentSessionCount",
					"How many sessions were open at the time.",
				),
			},
		},
	};
};

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
	const deviceActors = await loadUserNames(
		database,
		devices.flatMap((device) => [device.createdBy, device.revokedBy]),
	);
	return [
		tablePart(
			"sessions",
			SESSION_COLUMNS,
			sessions.map(({ session: row, extension }) => ({
				created_at: instantText(row.createdAt),
				updated_at: instantText(row.updatedAt),
				expires_at: instantText(row.expiresAt),
				ip_address: row.ipAddress,
				user_agent: row.userAgent,
				impersonated: row.impersonatedBy !== null,
				country: extension?.country ?? null,
				region: extension?.region ?? null,
				city: extension?.city ?? null,
				mfa_method: extension?.mfaMethod ?? null,
				mfa_verified_at: instantText(extension?.mfaVerifiedAt),
				last_activity_at: instantText(extension?.lastActivityAt),
			})),
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
				created_by: nameOf(deviceActors, row.createdBy),
				revoked_at: instantText(row.revokedAt),
				revoked_by: nameOf(deviceActors, row.revokedBy),
				revoke_reason: row.revokeReason,
			})),
		),
		recordPart(
			"settings",
			settings
				? {
						dashboard_widget_order:
							settings.dashboardWidgetOrder === null
								? null
								: JSON.stringify(settings.dashboardWidgetOrder),
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
