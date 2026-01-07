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

export type OnboardingProfileFormValues = z.infer<typeof onboardingProfileSchema>;
export type OnboardingWorkScheduleFormValues = z.infer<typeof onboardingWorkScheduleSchema>;

// Step navigation types
export type OnboardingStep = "welcome" | "organization" | "profile" | "work_schedule" | "complete";

export const ONBOARDING_STEPS: Record<OnboardingStep, { order: number; path: string; required: boolean; label: string }> = {
	welcome: { order: 1, path: "/onboarding/welcome", required: true, label: "Welcome" },
	organization: { order: 2, path: "/onboarding/organization", required: false, label: "Organization" },
	profile: { order: 3, path: "/onboarding/profile", required: true, label: "Profile" },
	work_schedule: { order: 4, path: "/onboarding/work-schedule", required: false, label: "Schedule" },
	complete: { order: 5, path: "/onboarding/complete", required: true, label: "Complete" },
} as const;

// Helper to get the correct path for a step
export function getOnboardingStepPath(step: string | null): string {
	if (!step) return ONBOARDING_STEPS.welcome.path;
	const stepConfig = ONBOARDING_STEPS[step as OnboardingStep];
	return stepConfig?.path ?? ONBOARDING_STEPS.welcome.path;
}
