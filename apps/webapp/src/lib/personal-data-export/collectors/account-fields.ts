/**
 * The README's explanation of every part and field of the Account category
 * (#811, #1171). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

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
					"Whether platform support opened this session as you. Its IP address, browser and location are then left out: they are support's, not yours.",
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
