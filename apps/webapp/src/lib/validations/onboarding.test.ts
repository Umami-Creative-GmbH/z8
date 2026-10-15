import { describe, expect, it } from "vitest";
import { getNextOnboardingStep, getOnboardingStepPath, getVisibleSteps } from "./onboarding";

describe("onboarding steps", () => {
	it("goes from the vacation policy straight to work templates for admins", () => {
		expect(getNextOnboardingStep("vacation_policy", true)).toBe("work_templates");
		expect(getVisibleSteps(true)).not.toContain("holiday_setup");
	});

	it("resumes a stored retired holiday step at work templates", () => {
		expect(getOnboardingStepPath("holiday_setup")).toBe("/onboarding/work-templates");
	});

	it("falls back to welcome for unknown steps", () => {
		expect(getOnboardingStepPath("nope")).toBe("/onboarding/welcome");
		expect(getOnboardingStepPath(null)).toBe("/onboarding/welcome");
	});
});
