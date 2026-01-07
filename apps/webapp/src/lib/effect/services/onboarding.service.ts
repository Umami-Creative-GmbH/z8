import { Context, Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { user, organization } from "@/db/auth-schema";
import { employee, employeeWorkSchedule, member } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	AuthenticationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
	ConflictError,
} from "../errors";
import { AuthService } from "./auth.service";
import { DatabaseService } from "./database.service";
import type {
	OnboardingProfileFormValues,
	OnboardingWorkScheduleFormValues,
	OnboardingStep,
} from "@/lib/validations/onboarding";
import type { OrganizationFormValues } from "@/lib/validations/organization";

export interface OnboardingSummary {
	hasOrganization: boolean;
	organizationName?: string;
	profileCompleted: boolean;
	workScheduleSet: boolean;
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
		) => Effect.Effect<{ organizationId: string }, AuthenticationError | DatabaseError | ValidationError>;
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
							.update(user)
							.set({
								onboardingStep: "welcome",
								onboardingStartedAt: new Date(),
							})
							.where(eq(user.id, session.user.id));
					});
				}),

			// Update onboarding step
			updateOnboardingStep: (step: OnboardingStep) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("updateOnboardingStep", async () => {
						await dbService.db
							.update(user)
							.set({
								onboardingStep: step,
							})
							.where(eq(user.id, session.user.id));
					});
				}),

			// Complete onboarding
			completeOnboarding: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("completeOnboarding", async () => {
						await dbService.db
							.update(user)
							.set({
								onboardingComplete: true,
								onboardingStep: null,
								onboardingCompletedAt: new Date(),
							})
							.where(eq(user.id, session.user.id));
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

					// Update onboarding step and reset canCreateOrganizations
					yield* dbService.query("updateOnboardingStepAfterOrgCreation", async () => {
						await dbService.db
							.update(user)
							.set({
								onboardingStep: "profile",
								canCreateOrganizations: false, // Reset after creation
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
							.update(user)
							.set({
								onboardingStep: "profile",
							})
							.where(eq(user.id, session.user.id));
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
						} else {
							// Create new employee record with organizationId if available
							await dbService.db.insert(employee).values({
								userId: session.user.id,
								organizationId: activeOrgId || null,
								...profileData,
							});
						}

						// Update onboarding step
						await dbService.db
							.update(user)
							.set({
								onboardingStep: "work_schedule",
							})
							.where(eq(user.id, session.user.id));
					});
				}),

			// Skip profile setup
			skipProfileSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipProfileSetup", async () => {
						await dbService.db
							.update(user)
							.set({
								onboardingStep: "work_schedule",
							})
							.where(eq(user.id, session.user.id));
					});
				}),

			// Set work schedule
			setWorkSchedule: (data: OnboardingWorkScheduleFormValues) =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();
					const activeOrgId = session.session.activeOrganizationId;

					yield* dbService.query("setWorkSchedule", async () => {
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

						if (!emp) {
							// Create employee record with organizationId if available
							const result = await dbService.db
								.insert(employee)
								.values({
									userId: session.user.id,
									organizationId: activeOrgId || null,
								})
								.returning();
							emp = result[0];
						}

						if (!emp) {
							throw new Error("Failed to create employee record");
						}

						// Create work schedule (simple mode for onboarding)
						await dbService.db.insert(employeeWorkSchedule).values({
							employeeId: emp.id,
							hoursPerWeek: String(data.hoursPerWeek),
							workClassification: data.workClassification,
							scheduleType: "simple",
							effectiveFrom: data.effectiveFrom,
							createdBy: emp.id,
						});

						// Update onboarding step
						await dbService.db
							.update(user)
							.set({
								onboardingStep: "complete",
							})
							.where(eq(user.id, session.user.id));
					});
				}),

			// Skip work schedule setup
			skipWorkScheduleSetup: () =>
				Effect.gen(function* () {
					const session = yield* authService.getSession();

					yield* dbService.query("skipWorkScheduleSetup", async () => {
						await dbService.db
							.update(user)
							.set({
								onboardingStep: "complete",
							})
							.where(eq(user.id, session.user.id));
					});
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

						// Check if work schedule is set
						const hasWorkSchedule = emp?.id
							? await dbService.db.query.employeeWorkSchedule.findFirst({
									where: eq(employeeWorkSchedule.employeeId, emp.id),
							  })
							: null;

						const summaryData: OnboardingSummary = {
							hasOrganization: !!membership,
							organizationName: membership?.organization?.name,
							profileCompleted: !!(emp?.firstName && emp?.lastName),
							workScheduleSet: !!hasWorkSchedule,
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
						const userData = await dbService.db.query.user.findFirst({
							where: eq(user.id, session.user.id),
							columns: {
								onboardingComplete: true,
								onboardingStep: true,
							},
						});

						return {
							onboardingComplete: userData?.onboardingComplete ?? false,
							onboardingStep: userData?.onboardingStep ?? null,
						};
					});

					return status;
				}),
		});
	}),
);
