import { describe, expect, it } from "vitest";
import {
	getNextOnboardingStep,
	getNextOnboardingStepPath,
	getOnboardingStepPath,
	getVisibleSteps,
} from "./onboarding";

describe("onboarding steps", () => {
	it("excludes retired steps from visible steps and orders admin and non-admin flows", () => {
		expect(getVisibleSteps(true)).toEqual([
			"welcome",
			"organization",
			"profile",
			"vacation_policy",
			"work_templates",
			"wellness",
			"notifications",
			"complete",
		]);
		expect(getVisibleSteps(false)).toEqual([
			"welcome",
			"organization",
			"profile",
			"wellness",
			"notifications",
			"complete",
		]);
		expect(getVisibleSteps(true)).not.toContain("holiday_setup");
		expect(getVisibleSteps(true)).not.toContain("work_schedule");
	});

	it("routes profile directly to vacation policy for admins and wellness for non-admins", () => {
		expect(getNextOnboardingStep("profile", true)).toBe("vacation_policy");
		expect(getNextOnboardingStepPath("profile", true)).toBe("/onboarding/vacation-policy");
		expect(getNextOnboardingStep("profile", false)).toBe("wellness");
		expect(getNextOnboardingStepPath("profile", false)).toBe("/onboarding/wellness");
	});

	it("routes vacation policy to work templates and work templates to wellness for admins", () => {
		expect(getNextOnboardingStep("vacation_policy", true)).toBe("work_templates");
		expect(getNextOnboardingStepPath("vacation_policy", true)).toBe("/onboarding/work-templates");
		expect(getNextOnboardingStep("work_templates", true)).toBe("wellness");
		expect(getNextOnboardingStepPath("work_templates", true)).toBe("/onboarding/wellness");
		expect(getNextOnboardingStep("complete", true)).toBeNull();
		expect(getNextOnboardingStepPath("complete", true)).toBeNull();
	});

	it("maps retired steps to their successor paths", () => {
		expect(getOnboardingStepPath("holiday_setup")).toBe("/onboarding/work-templates");
		expect(getOnboardingStepPath("work_schedule")).toBe("/onboarding/vacation-policy");
	});

	it("falls back to welcome for unknown steps", () => {
		expect(getOnboardingStepPath("nope")).toBe("/onboarding/welcome");
		expect(getOnboardingStepPath(null)).toBe("/onboarding/welcome");
	});
});
