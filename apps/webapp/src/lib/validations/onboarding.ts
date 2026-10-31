import { z } from "zod";
import { birthdayInputToUTCDate } from "@/lib/datetime/birthday";

export const onboardingProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(50),
	lastName: z.string().min(1, "Last name is required").max(50),
	gender: z.enum(["male", "female", "other"]).optional(),
	birthday: z.preprocess(
		(value) => birthdayInputToUTCDate(value as Date | string | null | undefined),
		z.date().optional(),
	),
	weekStartDay: z.enum(["sunday", "monday"]).default("sunday"),
	timeFormat: z.enum(["24h", "12h"]).default("24h"),
	helpImproveProduct: z.boolean().default(true),
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
export type OnboardingProfileFormInput = z.input<typeof onboardingProfileSchema>;
export type OnboardingWorkScheduleFormValues = z.infer<typeof onboardingWorkScheduleSchema>;
export type OnboardingVacationPolicyFormValues = z.infer<typeof onboardingVacationPolicySchema>;
export type OnboardingWorkTemplateFormValues = z.infer<typeof onboardingWorkTemplateSchema>;
export type OnboardingNotificationsFormValues = z.infer<typeof onboardingNotificationsSchema>;

export {
	ADMIN_ONLY_STEPS,
	getNextOnboardingStep,
	getOnboardingStepPath,
	getVisibleSteps,
	ONBOARDING_STEPS,
	type OnboardingStep,
} from "./onboarding-steps";
