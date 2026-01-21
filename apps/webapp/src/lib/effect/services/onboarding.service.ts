import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { headers } from "next/headers";
import { member, user } from "@/db/auth-schema";
import {
	employee,
	holidayPreset,
	holidayPresetAssignment,
	notificationPreference,
	userSettings,
	vacationAllowance,
	vacationPolicyAssignment,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import type {
	OnboardingHolidaySetupFormValues,
	OnboardingNotificationsFormValues,
	OnboardingProfileFormValues,
	OnboardingStep,
	OnboardingVacationPolicyFormValues,
	OnboardingWorkScheduleFormValues,
	OnboardingWorkTemplateFormValues,
} from "@/lib/validations/onboarding";
import type { OnboardingWellnessFormValues } from "@/lib/validations/wellness";
import type { OrganizationFormValues } from "@/lib/validations/organization";
import {
	type AuthenticationError,
	type DatabaseError,
	type NotFoundError,
	ValidationError,
} from "../errors";
import { AuthService } from "./auth.service";
import { DatabaseService } from "./database.service";

export interface OnboardingSummary {
	hasOrganization: boolean;
	organizationName?: string;
	profileCompleted: boolean;
	workPolicySet: boolean;
	// Admin setup summary (only present if user is admin)
	isAdmin: boolean;
	vacationPolicyCreated?: boolean;
	holidayPresetCreated?: boolean;
	workTemplateCreated?: boolean;
	// Wellness
	wellnessConfigured: boolean;
	waterReminderEnabled?: boolean;
	// Notifications
	notificationsConfigured: boolean;
}

export class OnboardingService extends Context.Tag("OnboardingService")<
	OnboardingService,
	{
		// Step tracking
		readonly startOnboarding: () => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly updateOnboardingStep: (
			step: OnboardingStep,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly completeOnboarding: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Organization setup
		readonly createOrganization: (
			data: OrganizationFormValues,
		) => Effect.Effect<
			{ organizationId: string },
			AuthenticationError | DatabaseError | ValidationError
		>;
		readonly skipOrganizationSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Profile setup
		readonly updateProfile: (
			data: OnboardingProfileFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipProfileSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Work schedule setup
		readonly setWorkSchedule: (
			data: OnboardingWorkScheduleFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError | NotFoundError>;
		readonly skipWorkScheduleSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Admin setup - Vacation Policy
		readonly createVacationPolicy: (
			data: OnboardingVacationPolicyFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipVacationPolicySetup: () => Effect.Effect<
			void,
			AuthenticationError | DatabaseError
		>;

		// Admin setup - Holiday Setup
		readonly createHolidayPreset: (
			data: OnboardingHolidaySetupFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipHolidaySetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Admin setup - Work Schedule Templates
		readonly createWorkTemplate: (
			data: OnboardingWorkTemplateFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipWorkTemplateSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Wellness setup
		readonly configureWellness: (
			data: OnboardingWellnessFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipWellnessSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Notifications setup
		readonly configureNotifications: (
			data: OnboardingNotificationsFormValues,
		) => Effect.Effect<void, AuthenticationError | DatabaseError>;
		readonly skipNotificationsSetup: () => Effect.Effect<void, AuthenticationError | DatabaseError>;

		// Completion
		readonly getOnboardingSummary: () => Effect.Effect<
			OnboardingSummary,
			AuthenticationError | DatabaseError
		>;

		// Status check
		readonly getOnboardingStatus: () => Effect.Effect<
			{ onboardingComplete: boolean; onboardingStep: string | null },
			AuthenticationError | DatabaseError
		>;

		// Check if user is admin of their organization
		readonly isUserAdmin: () => Effect.Effect<boolean, AuthenticationError | DatabaseError>;
	}
>() {}

export const OnboardingServiceLive = Layer.effect(
	OnboardingService,
	Effect.gen(function* () {
		const authService = yield* AuthService;
		const dbService = yield* DatabaseService;

		return OnboardingService.of({
			// Start onboarding
			startOnboarding: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("startOnboarding", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "welcome",
								onboardingStartedAt: new Date(),
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: "welcome",
									onboardingStartedAt: new Date(),
								},
							});
					});
				}),

			// Update onboarding step
			updateOnboardingStep: (step: OnboardingStep) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("updateOnboardingStep", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: step,
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: step,
								},
							});
					});
				}),

			// Complete onboarding
			completeOnboarding: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("completeOnboarding", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingComplete: true,
								onboardingStep: null,
								onboardingCompletedAt: new Date(),
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingComplete: true,
									onboardingStep: null,
									onboardingCompletedAt: new Date(),
								},
							});
					});
				}),

			// Create organization
			createOrganization: (data: OrganizationFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					// First, temporarily enable organization creation for this user
					yield* dbService.query("enableOrgCreation", async () => {
						await dbService.db
							.update(user)
							.set({
								canCreateOrganizations: true,
							})
							.where(eq(user.id, session.user.id));
					});

					// Create organization using Better Auth server-side API
					const result = yield* Effect.tryPromise({
						try: async () => {
							const hdrs = await headers();
							const orgResult = await auth.api.createOrganization({
								headers: hdrs,
								body: {
									name: data.name,
									slug: data.slug,
								},
							});

							return orgResult;
						},
						catch: (error) => {
							// Reset permission on failure
							dbService.db
								.update(user)
								.set({ canCreateOrganizations: false })
								.where(eq(user.id, session.user.id))
								.then(() => {})
								.catch(() => {});

							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to create organization",
								field: "slug",
							});
						},
					});

					// Update onboarding step on userSettings and reset canCreateOrganizations on user
					yield* dbService.query("updateOnboardingStepAfterOrgCreation", async () => {
						// Update onboarding step in userSettings
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "profile",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: "profile",
								},
							});
						// Reset canCreateOrganizations on user table
						await dbService.db
							.update(user)
							.set({
								canCreateOrganizations: false,
							})
							.where(eq(user.id, session.user.id));
					});

					return { organizationId: result?.id || "" };
				}),

			// Skip organization setup
			skipOrganizationSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipOrganizationSetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "profile",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: "profile",
								},
							});
					});
				}),

			// Update profile
			updateProfile: (data: OnboardingProfileFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("updateProfile", async () => {
						// Find employee record - prioritize the one with the active organization
						let emp = activeOrgId
							? await dbService.db.query.employee.findFirst({
									where: and(
										eq(employee.userId, session.user.id),
										eq(employee.organizationId, activeOrgId),
									),
								})
							: null;

						// Fallback: find any employee record for this user
						if (!emp) {
							emp = await dbService.db.query.employee.findFirst({
								where: eq(employee.userId, session.user.id),
							});
						}

						const profileData = {
							firstName: data.firstName,
							lastName: data.lastName,
							gender: data.gender || null,
							birthday: data.birthday || null,
						};

						if (emp) {
							// Update existing employee record
							await dbService.db.update(employee).set(profileData).where(eq(employee.id, emp.id));
						} else if (activeOrgId) {
							// Create new employee record (only if we have an organization)
							await dbService.db.insert(employee).values({
								userId: session.user.id,
								organizationId: activeOrgId,
								...profileData,
							});
						}
						// If no existing employee and no active org, skip employee creation
						// The employee will be created when they join an organization

						// Update onboarding step in userSettings
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "work_schedule",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: "work_schedule",
								},
							});
					});
				}),

			// Skip profile setup
			skipProfileSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipProfileSetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "work_schedule",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: "work_schedule",
								},
							});
					});
				}),

			// Set work schedule
			// Note: Work schedules are now template-based and managed at org/team/employee level by admins
			// During onboarding, users will inherit their schedule from the organization default
			setWorkSchedule: (_data: OnboardingWorkScheduleFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("setWorkSchedule", async () => {
						// Find or create employee record
						let emp = activeOrgId
							? await dbService.db.query.employee.findFirst({
									where: and(
										eq(employee.userId, session.user.id),
										eq(employee.organizationId, activeOrgId),
									),
								})
							: null;

						if (!emp) {
							emp = await dbService.db.query.employee.findFirst({
								where: eq(employee.userId, session.user.id),
							});
						}

						if (!emp && activeOrgId) {
							// Create employee record with organizationId if available
							const result = await dbService.db
								.insert(employee)
								.values({
									userId: session.user.id,
									organizationId: activeOrgId,
								})
								.returning();
							emp = result[0];
						}

						// Determine next step based on admin status
						// Admins go to vacation_policy, employees go to wellness
						const membership = activeOrgId
							? await dbService.db.query.member.findFirst({
									where: and(
										eq(member.userId, session.user.id),
										eq(member.organizationId, activeOrgId),
									),
								})
							: null;
						const isAdmin = membership?.role === "owner" || membership?.role === "admin";
						const nextStep = isAdmin ? "vacation_policy" : "wellness";

						// Update onboarding step in userSettings
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: nextStep,
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: nextStep,
								},
							});
					});
				}),

			// Skip work schedule setup
			skipWorkScheduleSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("skipWorkScheduleSetup", async () => {
						// Determine next step based on admin status
						// Admins go to vacation_policy, employees go to wellness
						const membership = activeOrgId
							? await dbService.db.query.member.findFirst({
									where: and(
										eq(member.userId, session.user.id),
										eq(member.organizationId, activeOrgId),
									),
								})
							: null;
						const isAdmin = membership?.role === "owner" || membership?.role === "admin";
						const nextStep = isAdmin ? "vacation_policy" : "wellness";

						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: nextStep,
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									onboardingStep: nextStep,
								},
							});
					});
				}),

			// Admin setup - Create vacation policy
			createVacationPolicy: (data: OnboardingVacationPolicyFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("createVacationPolicy", async () => {
						if (!activeOrgId) {
							// Skip if no active organization
							await dbService.db
								.insert(userSettings)
								.values({
									userId: session.user.id,
									onboardingStep: "holiday_setup",
								})
								.onConflictDoUpdate({
									target: userSettings.userId,
									set: { onboardingStep: "holiday_setup" },
								});
							return;
						}

						// Get current date as start date
						const today = new Date().toISOString().split("T")[0];

						// Create vacation policy with isCompanyDefault=true (no separate assignment needed)
						await dbService.db.insert(vacationAllowance).values({
							organizationId: activeOrgId,
							startDate: today,
							validUntil: null, // Ongoing policy
							isCompanyDefault: true, // This is the company default
							isActive: true,
							name: data.name,
							defaultAnnualDays: data.defaultAnnualDays.toString(),
							accrualType: data.accrualType,
							accrualStartMonth: 1,
							allowCarryover: data.allowCarryover,
							maxCarryoverDays: data.maxCarryoverDays?.toString() || null,
							carryoverExpiryMonths: data.allowCarryover ? 3 : null,
							createdBy: session.user.id,
						});

						// Update onboarding step in userSettings
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "holiday_setup",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "holiday_setup" },
							});
					});
				}),

			// Skip vacation policy setup
			skipVacationPolicySetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipVacationPolicySetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "holiday_setup",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "holiday_setup" },
							});
					});
				}),

			// Admin setup - Create holiday preset
			createHolidayPreset: (data: OnboardingHolidaySetupFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("createHolidayPreset", async () => {
						if (!activeOrgId) {
							await dbService.db
								.insert(userSettings)
								.values({
									userId: session.user.id,
									onboardingStep: "work_templates",
								})
								.onConflictDoUpdate({
									target: userSettings.userId,
									set: { onboardingStep: "work_templates" },
								});
							return;
						}

						// Create holiday preset
						const [preset] = await dbService.db
							.insert(holidayPreset)
							.values({
								organizationId: activeOrgId,
								name: data.presetName,
								description: `Holidays for ${data.countryCode}${data.stateCode ? ` - ${data.stateCode}` : ""}`,
								countryCode: data.countryCode,
								stateCode: data.stateCode || null,
								color: "#4F46E5",
								isActive: true,
								createdBy: session.user.id,
							})
							.returning();

						// Assign preset to organization if setAsDefault
						if (preset && data.setAsDefault) {
							await dbService.db.insert(holidayPresetAssignment).values({
								presetId: preset.id,
								organizationId: activeOrgId,
								assignmentType: "organization",
								isActive: true,
								createdBy: session.user.id,
							});
						}

						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "work_templates",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "work_templates" },
							});
					});
				}),

			// Skip holiday setup
			skipHolidaySetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipHolidaySetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "work_templates",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "work_templates" },
							});
					});
				}),

			// Admin setup - Create work schedule template
			createWorkTemplate: (data: OnboardingWorkTemplateFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("createWorkTemplate", async () => {
						if (!activeOrgId) {
							await dbService.db
								.insert(userSettings)
								.values({
									userId: session.user.id,
									onboardingStep: "wellness",
								})
								.onConflictDoUpdate({
									target: userSettings.userId,
									set: { onboardingStep: "wellness" },
								});
							return;
						}

						// Create work policy
						const [policy] = await dbService.db
							.insert(workPolicy)
							.values({
								organizationId: activeOrgId,
								name: data.name,
								description: "Created during onboarding",
								scheduleEnabled: true,
								regulationEnabled: false,
								isActive: true,
								isDefault: data.setAsDefault,
								createdBy: session.user.id,
								updatedAt: new Date(),
							})
							.returning();

						// Create schedule configuration
						if (policy) {
							const [schedule] = await dbService.db
								.insert(workPolicySchedule)
								.values({
									policyId: policy.id,
									scheduleCycle: "weekly",
									scheduleType: "simple",
									workingDaysPreset: "weekdays",
									hoursPerCycle: data.hoursPerWeek.toString(),
									homeOfficeDaysPerCycle: 0,
								})
								.returning();

							// Create schedule days
							if (schedule) {
								const allDays = [
									"monday",
									"tuesday",
									"wednesday",
									"thursday",
									"friday",
									"saturday",
									"sunday",
								] as const;
								const hoursPerDay =
									data.workingDays.length > 0 ? data.hoursPerWeek / data.workingDays.length : 0;

								await dbService.db.insert(workPolicyScheduleDay).values(
									allDays.map((day) => ({
										scheduleId: schedule.id,
										dayOfWeek: day,
										hoursPerDay: data.workingDays.includes(day) ? hoursPerDay.toFixed(1) : "0",
										isWorkDay: data.workingDays.includes(day),
									})),
								);
							}

							// Assign to organization if setAsDefault
							if (data.setAsDefault) {
								await dbService.db.insert(workPolicyAssignment).values({
									policyId: policy.id,
									organizationId: activeOrgId,
									assignmentType: "organization",
									priority: 0,
									effectiveFrom: new Date(),
									isActive: true,
									createdBy: session.user.id,
								});
							}
						}

						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "wellness",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "wellness" },
							});
					});
				}),

			// Skip work template setup
			skipWorkTemplateSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipWorkTemplateSetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "wellness",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "wellness" },
							});
					});
				}),

			// Configure wellness (water reminders)
			configureWellness: (data: OnboardingWellnessFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("configureWellness", async () => {
						// Upsert water reminder settings and onboarding step to userSettings
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								waterReminderEnabled: data.enableWaterReminder,
								waterReminderPreset: data.waterReminderPreset,
								waterReminderIntervalMinutes: data.waterReminderIntervalMinutes,
								waterReminderDailyGoal: data.waterReminderDailyGoal,
								onboardingStep: "notifications",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: {
									waterReminderEnabled: data.enableWaterReminder,
									waterReminderPreset: data.waterReminderPreset,
									waterReminderIntervalMinutes: data.waterReminderIntervalMinutes,
									waterReminderDailyGoal: data.waterReminderDailyGoal,
									onboardingStep: "notifications",
								},
							});
					});
				}),

			// Skip wellness setup
			skipWellnessSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipWellnessSetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "notifications",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "notifications" },
							});
					});
				}),

			// Configure notifications
			configureNotifications: (data: OnboardingNotificationsFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("configureNotifications", async () => {
						// Save notification preferences
						// Schema uses (type, channel, enabled) per row, not columns per channel
						const notificationTypes = [
							{ type: "approval_request_submitted" as const, enabled: data.notifyApprovals },
							{ type: "approval_request_approved" as const, enabled: data.notifyStatusUpdates },
							{ type: "approval_request_rejected" as const, enabled: data.notifyStatusUpdates },
							{ type: "team_member_added" as const, enabled: data.notifyTeamChanges },
							{ type: "team_member_removed" as const, enabled: data.notifyTeamChanges },
						];

						const channels = [
							{ channel: "in_app" as const, isEnabled: true },
							{ channel: "push" as const, isEnabled: data.enablePush },
							{ channel: "email" as const, isEnabled: data.enableEmail },
						];

						for (const { type, enabled } of notificationTypes) {
							for (const { channel, isEnabled } of channels) {
								// Upsert notification preferences
								const existing = await dbService.db.query.notificationPreference.findFirst({
									where: and(
										eq(notificationPreference.userId, session.user.id),
										eq(notificationPreference.notificationType, type),
										eq(notificationPreference.channel, channel),
									),
								});

								if (existing) {
									await dbService.db
										.update(notificationPreference)
										.set({
											enabled: enabled && isEnabled,
										})
										.where(eq(notificationPreference.id, existing.id));
								} else {
									await dbService.db.insert(notificationPreference).values({
										userId: session.user.id,
										notificationType: type,
										channel,
										enabled: enabled && isEnabled,
									});
								}
							}
						}

						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "complete",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "complete" },
							});
					});
				}),

			// Skip notifications setup
			skipNotificationsSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipNotificationsSetup", async () => {
						await dbService.db
							.insert(userSettings)
							.values({
								userId: session.user.id,
								onboardingStep: "complete",
							})
							.onConflictDoUpdate({
								target: userSettings.userId,
								set: { onboardingStep: "complete" },
							});
					});
				}),

			// Check if user is admin of their organization
			isUserAdmin: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					if (!activeOrgId) {
						return false;
					}

					const isAdmin = yield* dbService.query("isUserAdmin", async () => {
						const membership = await dbService.db.query.member.findFirst({
							where: and(
								eq(member.userId, session.user.id),
								eq(member.organizationId, activeOrgId),
							),
						});
						return membership?.role === "owner" || membership?.role === "admin";
					});

					return isAdmin;
				}),

			// Get onboarding summary
			getOnboardingSummary: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					const summary = yield* dbService.query("getOnboardingSummary", async () => {
						// Check if user has an organization
						const membership = await dbService.db.query.member.findFirst({
							where: eq(member.userId, session.user.id),
							with: {
								organization: true,
							},
						});

						// Check if profile is completed
						const emp = await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});

						// Check if user is admin
						const isAdmin = membership?.role === "owner" || membership?.role === "admin";

						// Check if work policy is set (via org default or explicit assignment)
						let hasWorkPolicy = false;
						let hasVacationPolicy = false;
						let hasHolidayPreset = false;
						let hasWorkTemplate = false;

						if (membership?.organizationId) {
							// Check for org-level work policy assignment
							const orgAssignment = await dbService.db.query.workPolicyAssignment.findFirst({
								where: and(
									eq(workPolicyAssignment.organizationId, membership.organizationId),
									eq(workPolicyAssignment.assignmentType, "organization"),
									eq(workPolicyAssignment.isActive, true),
								),
							});
							hasWorkPolicy = !!orgAssignment;

							// Or check for employee-specific assignment
							if (!hasWorkPolicy && emp?.id) {
								const empAssignment = await dbService.db.query.workPolicyAssignment.findFirst({
									where: and(
										eq(workPolicyAssignment.employeeId, emp.id),
										eq(workPolicyAssignment.assignmentType, "employee"),
										eq(workPolicyAssignment.isActive, true),
									),
								});
								hasWorkPolicy = !!empAssignment;
							}

							// Check for vacation policy (admin only)
							if (isAdmin) {
								// Check for an active company default vacation policy
								const vacPolicy = await dbService.db.query.vacationAllowance.findFirst({
									where: and(
										eq(vacationAllowance.organizationId, membership.organizationId),
										eq(vacationAllowance.isCompanyDefault, true),
										eq(vacationAllowance.isActive, true),
									),
								});
								hasVacationPolicy = !!vacPolicy;

								// Check for holiday preset
								const holidayPresetRecord = await dbService.db.query.holidayPreset.findFirst({
									where: eq(holidayPreset.organizationId, membership.organizationId),
								});
								hasHolidayPreset = !!holidayPresetRecord;

								// Check for work policy
								const workPolicyRecord = await dbService.db.query.workPolicy.findFirst({
									where: eq(workPolicy.organizationId, membership.organizationId),
								});
								hasWorkTemplate = !!workPolicyRecord;
							}
						}

						// Check if notifications are configured
						const notifPrefs = await dbService.db.query.notificationPreference.findFirst({
							where: eq(notificationPreference.userId, session.user.id),
						});

						// Check wellness configuration (water reminder) from userSettings
						const userSettingsData = await dbService.db.query.userSettings.findFirst({
							where: eq(userSettings.userId, session.user.id),
						});
						const waterReminderEnabled = userSettingsData?.waterReminderEnabled ?? false;

						const summaryData: OnboardingSummary = {
							hasOrganization: !!membership,
							organizationName: membership?.organization?.name,
							profileCompleted: !!(emp?.firstName && emp?.lastName),
							workPolicySet: hasWorkPolicy,
							isAdmin,
							vacationPolicyCreated: isAdmin ? hasVacationPolicy : undefined,
							holidayPresetCreated: isAdmin ? hasHolidayPreset : undefined,
							workTemplateCreated: isAdmin ? hasWorkTemplate : undefined,
							wellnessConfigured: true, // Step was visited (even if skipped)
							waterReminderEnabled,
							notificationsConfigured: !!notifPrefs,
						};

						return summaryData;
					});

					return summary;
				}),

			// Get onboarding status
			getOnboardingStatus: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					const status = yield* dbService.query("getOnboardingStatus", async () => {
						const userSettingsData = await dbService.db.query.userSettings.findFirst({
							where: eq(userSettings.userId, session.user.id),
							columns: {
								onboardingComplete: true,
								onboardingStep: true,
							},
						});

						return {
							onboardingComplete: userSettingsData?.onboardingComplete ?? false,
							onboardingStep: userSettingsData?.onboardingStep ?? null,
						};
					});

					return status;
				}),
		});
	}),
);
