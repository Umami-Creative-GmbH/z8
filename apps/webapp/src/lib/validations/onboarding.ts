import { z } from "zod";

export const onboardingProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(50),
	lastName: z.string().min(1, "Last name is required").max(50),
	gender: z.enum(["male", "female", "other"]).optional(),
	birthday: z.date().optional(),
});

export const onboardingWorkScheduleSchema = z.object({
	hoursPerWeek: z.number().min(0).max(168),
	workClassification: z.enum(["daily", "weekly", "monthly"]),
	effectiveFrom: z.date(),
});

export const onboardingVacationPolicySchema = z.object({
	name: z.string().min(1, "Policy name is required").max(100),
	defaultAnnualDays: z.number().min(0).max(365).default(25),
	accrualType: z.enum(["annual", "monthly", "biweekly"]).default("annual"),
	allowCarryover: z.boolean().default(true),
	maxCarryoverDays: z.number().min(0).max(365).optional(),
});

export const onboardingHolidaySetupSchema = z.object({
	countryCode: z.string().min(2).max(2),
	stateCode: z.string().optional(),
	presetName: z.string().min(1).max(100),
	setAsDefault: z.boolean().default(true),
});

export const onboardingWorkTemplateSchema = z.object({
	name: z.string().min(1, "Template name is required").max(100).default("Standard"),
	hoursPerWeek: z.number().min(0).max(168).default(40),
	workingDays: z
		.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]))
		.default(["monday", "tuesday", "wednesday", "thursday", "friday"]),
	setAsDefault: z.boolean().default(true),
});

export const onboardingNotificationsSchema = z.object({
	enablePush: z.boolean().default(false),
	enableEmail: z.boolean().default(true),
	notifyApprovals: z.boolean().default(true),
	notifyStatusUpdates: z.boolean().default(true),
	notifyTeamChanges: z.boolean().default(true),
});

export type OnboardingProfileFormValues = z.infer<typeof onboardingProfileSchema>;
export type OnboardingWorkScheduleFormValues = z.infer<typeof onboardingWorkScheduleSchema>;
export type OnboardingVacationPolicyFormValues = z.infer<typeof onboardingVacationPolicySchema>;
export type OnboardingHolidaySetupFormValues = z.infer<typeof onboardingHolidaySetupSchema>;
export type OnboardingWorkTemplateFormValues = z.infer<typeof onboardingWorkTemplateSchema>;
export type OnboardingNotificationsFormValues = z.infer<typeof onboardingNotificationsSchema>;

// Step navigation types - base steps shown to all users
export type OnboardingStep =
	| "welcome"
	| "organization"
	| "profile"
	| "work_schedule"
	| "vacation_policy"
	| "holiday_setup"
	| "work_templates"
	| "wellness"
	| "notifications"
	| "complete";

// Admin-only steps (shown after work_schedule if user created an organization)
export const ADMIN_ONLY_STEPS: OnboardingStep[] = [
	"vacation_policy",
	"holiday_setup",
	"work_templates",
];

// Base steps configuration
export const ONBOARDING_STEPS: Record<
	OnboardingStep,
	{ order: number; path: string; required: boolean; label: string; adminOnly: boolean }
> = {
	welcome: {
		order: 1,
		path: "/onboarding/welcome",
		required: true,
		label: "Welcome",
		adminOnly: false,
	},
	organization: {
		order: 2,
		path: "/onboarding/organization",
		required: false,
		label: "Organization",
		adminOnly: false,
	},
	profile: {
		order: 3,
		path: "/onboarding/profile",
		required: true,
		label: "Profile",
		adminOnly: false,
	},
	work_schedule: {
		order: 4,
		path: "/onboarding/work-schedule",
		required: false,
		label: "Schedule",
		adminOnly: false,
	},
	vacation_policy: {
		order: 5,
		path: "/onboarding/vacation-policy",
		required: false,
		label: "Vacation",
		adminOnly: true,
	},
	holiday_setup: {
		order: 6,
		path: "/onboarding/holiday-setup",
		required: false,
		label: "Holidays",
		adminOnly: true,
	},
	work_templates: {
		order: 7,
		path: "/onboarding/work-templates",
		required: false,
		label: "Templates",
		adminOnly: true,
	},
	wellness: {
		order: 8,
		path: "/onboarding/wellness",
		required: false,
		label: "Wellness",
		adminOnly: false,
	},
	notifications: {
		order: 9,
		path: "/onboarding/notifications",
		required: false,
		label: "Notifications",
		adminOnly: false,
	},
	complete: {
		order: 10,
		path: "/onboarding/complete",
		required: true,
		label: "Complete",
		adminOnly: false,
	},
} as const;

// Helper to get the correct path for a step
export function getOnboardingStepPath(step: string | null): string {
	if (!step) return ONBOARDING_STEPS.welcome.path;
	const stepConfig = ONBOARDING_STEPS[step as OnboardingStep];
	return stepConfig?.path ?? ONBOARDING_STEPS.welcome.path;
}

// Helper to get visible steps based on whether user is admin
export function getVisibleSteps(isAdmin: boolean): OnboardingStep[] {
	return (
		Object.entries(ONBOARDING_STEPS) as [
			OnboardingStep,
			(typeof ONBOARDING_STEPS)[OnboardingStep],
		][]
	)
		.filter(([, config]) => !config.adminOnly || isAdmin)
		.sort(([, a], [, b]) => a.order - b.order)
		.map(([step]) => step);
}

// Helper to get next step based on current step and admin status
export function getNextOnboardingStep(
	currentStep: OnboardingStep,
	isAdmin: boolean,
): OnboardingStep | null {
	const visibleSteps = getVisibleSteps(isAdmin);
	const currentIndex = visibleSteps.indexOf(currentStep);
	if (currentIndex === -1 || currentIndex === visibleSteps.length - 1) {
		return null;
	}
	return visibleSteps[currentIndex + 1];
}
