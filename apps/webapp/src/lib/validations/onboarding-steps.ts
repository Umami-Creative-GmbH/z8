// Plain step navigation, kept apart from the zod schemas in ./onboarding so the sign-in
// redirect can import it without bundling zod schemas and Luxon.

// Step navigation types
export type OnboardingStep =
	| "welcome"
	| "organization"
	| "profile"
	| "work_schedule"
	| "vacation_policy"
	| "work_templates"
	| "wellness"
	| "notifications"
	| "complete";

// Admin-only steps (shown after work_schedule if user created an organization)
export const ADMIN_ONLY_STEPS: OnboardingStep[] = ["vacation_policy", "work_templates"];

// Base steps configuration
export const ONBOARDING_STEPS: Record<
	OnboardingStep,
	{ order: number; path: `/${string}`; required: boolean; label: string; adminOnly: boolean }
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
	work_templates: {
		order: 6,
		path: "/onboarding/work-templates",
		required: false,
		label: "Templates",
		adminOnly: true,
	},
	wellness: {
		order: 7,
		path: "/onboarding/wellness",
		required: false,
		label: "Wellness",
		adminOnly: false,
	},
	notifications: {
		order: 8,
		path: "/onboarding/notifications",
		required: false,
		label: "Notifications",
		adminOnly: false,
	},
	complete: {
		order: 9,
		path: "/onboarding/complete",
		required: true,
		label: "Complete",
		adminOnly: false,
	},
} as const;

// Steps removed from the flow that may still be stored in user_settings.onboarding_step,
// mapped to the step that now follows them. Holiday setup moved to settings.
const RETIRED_ONBOARDING_STEPS: Record<string, OnboardingStep> = {
	holiday_setup: "work_templates",
};

// Helper to get the correct path for a step
export function getOnboardingStepPath(step: string | null): `/${string}` {
	if (!step) return ONBOARDING_STEPS.welcome.path;
	const stepConfig = ONBOARDING_STEPS[(RETIRED_ONBOARDING_STEPS[step] ?? step) as OnboardingStep];
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
		.filter(
			([step, config]) => (!config.adminOnly || isAdmin) && (isAdmin || step !== "work_schedule"),
		)
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
