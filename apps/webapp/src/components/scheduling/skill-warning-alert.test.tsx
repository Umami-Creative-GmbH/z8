/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SkillValidationResult } from "@/lib/effect/services/skill.service";
import { SkillWarningAlert, SkillWarningBadge } from "./skill-warning-alert";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/{{(\w+)}}/g, (_match, key) => String(params?.[key] ?? `{{${key}}}`)),
	}),
}));

const preferredOnlyValidation: SkillValidationResult = {
	isQualified: true,
	hasBlockingIssues: false,
	requiresOverride: false,
	missingSkills: [
		{
			id: "skill-preferred",
			name: "Forklift Familiarity",
			category: "certification",
			isRequired: false,
		},
	],
	expiredSkills: [],
	issues: [
		{
			id: "skill-preferred",
			name: "Forklift Familiarity",
			category: "certification",
			isRequired: false,
			enforcementMode: "warning",
			issueType: "preferred",
		},
	],
};

describe("SkillWarningAlert", () => {
	it("shows preferred-only qualification issues as informational guidance", () => {
		render(<SkillWarningAlert validation={preferredOnlyValidation} />);

		expect(screen.getByText("Preferred Skills Missing")).toBeTruthy();
		expect(screen.getByText(/Forklift Familiarity/)).toBeTruthy();
		expect(screen.queryByText(/logged as an override/)).toBeNull();
	});
});

describe("SkillWarningBadge", () => {
	it("shows preferred-only qualification issue counts", () => {
		render(<SkillWarningBadge validation={preferredOnlyValidation} />);

		expect(screen.getByText("1 preferred missing")).toBeTruthy();
	});
});
