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

const preferredExpiredValidation: SkillValidationResult = {
	isQualified: true,
	hasBlockingIssues: false,
	requiresOverride: false,
	missingSkills: [],
	expiredSkills: [
		{
			id: "skill-preferred-expired",
			name: "CPR Familiarity",
			expiresAt: new Date("2026-01-01T00:00:00.000Z"),
		},
	],
	issues: [
		{
			id: "skill-preferred-expired",
			name: "CPR Familiarity",
			category: "training",
			isRequired: false,
			enforcementMode: "warning",
			issueType: "expired",
			expiresAt: new Date("2026-01-01T00:00:00.000Z"),
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

	it("shows preferred expired issues as informational guidance", () => {
		render(<SkillWarningAlert validation={preferredExpiredValidation} />);

		expect(screen.getByText("Preferred Skills Missing")).toBeTruthy();
		expect(screen.getByText(/CPR Familiarity/)).toBeTruthy();
		expect(screen.queryByText("Skill Requirements Not Met")).toBeNull();
	});
});

describe("SkillWarningBadge", () => {
	it("shows preferred-only qualification issue counts", () => {
		render(<SkillWarningBadge validation={preferredOnlyValidation} />);

		expect(screen.getByText("1 preferred missing")).toBeTruthy();
	});

	it("shows preferred expired issue counts instead of unqualified", () => {
		render(<SkillWarningBadge validation={preferredExpiredValidation} />);

		expect(screen.getByText("1 preferred missing")).toBeTruthy();
		expect(screen.queryByText("Unqualified")).toBeNull();
	});
});
