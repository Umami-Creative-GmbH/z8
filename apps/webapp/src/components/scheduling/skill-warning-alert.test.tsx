/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SkillValidationResult } from "@/lib/scheduling/skill-validation";
import { SkillWarningAlert } from "./skill-warning-alert";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

const OVERRIDE_PROMISE = /logged as a skill override/;

describe("SkillWarningAlert (#893)", () => {
	it("says a reason is needed and logged when a required skill is missing", () => {
		const validation: SkillValidationResult = {
			isQualified: false,
			missingSkills: [{ id: "s1", name: "Forklift", category: "equipment", isRequired: true }],
			expiredSkills: [],
		};

		render(<SkillWarningAlert validation={validation} />);

		expect(screen.getByText("Skill Requirements Not Met")).toBeTruthy();
		expect(screen.getByText(OVERRIDE_PROMISE)).toBeTruthy();
	});

	it("promises no override log for an expired preferred skill", () => {
		const validation: SkillValidationResult = {
			isQualified: true,
			missingSkills: [{ id: "s2", name: "French", category: "language", isRequired: false }],
			expiredSkills: [
				{
					id: "s2",
					name: "French",
					expiresAt: "2026-01-31",
					certificateOnFile: false,
					isRequired: false,
				},
			],
		};

		render(<SkillWarningAlert validation={validation} />);

		expect(screen.getByText("Preferred Skills Missing")).toBeTruthy();
		expect(screen.getAllByText(/French/).length).toBeGreaterThan(0);
		expect(screen.queryByText(OVERRIDE_PROMISE)).toBeNull();
	});
});
