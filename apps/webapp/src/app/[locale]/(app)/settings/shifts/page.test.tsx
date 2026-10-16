import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	access: vi.fn(),
	locations: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));
vi.mock("@/lib/settings-scheduling-access", () => ({
	getSchedulingSettingsAccessContext: mocks.access,
	getScopedSchedulingLocationsForSettings: mocks.locations,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/components/settings/shift-template-management", () => ({
	ShiftTemplateManagement: () => null,
}));
vi.mock("@/components/settings/coverage-rules-management", () => ({
	CoverageRulesManagement: () => null,
}));

import LegacyCoveragePage from "../coverage-rules/page";
import PlanningPage from "./page";

const renderPage = () => PlanningPage().props.children.type();
beforeEach(() => {
	vi.clearAllMocks();
	mocks.locations.mockResolvedValue([]);
	mocks.access.mockResolvedValue({
		organizationId: "org-1",
		canAccessShiftTemplates: true,
		canAccessCoverageRules: true,
		canManageCoverageSettings: false,
		manageableShiftTemplateSubareaIds: new Set(["template-area"]),
		manageableSubareaIds: new Set(["coverage-area"]),
	});
});
describe("merged Shift Planning permissions", () => {
	it("keeps template and coverage location scopes distinct", async () => {
		const page = await renderPage();
		expect(page.key).toBe("org-1");
		expect(page.props.tabs.map((tab: { value: string }) => tab.value)).toEqual([
			"templates",
			"coverage",
		]);
		expect(mocks.locations).toHaveBeenCalledWith({
			organizationId: "org-1",
			manageableSubareaIds: new Set(["template-area"]),
		});
		expect(mocks.locations).toHaveBeenCalledWith({
			organizationId: "org-1",
			manageableSubareaIds: new Set(["coverage-area"]),
		});
		expect(page.props.tabs[0].panel.props.manageableSubareaIds).toEqual([
			"template-area",
		]);
		expect(page.props.tabs[1].panel.props).toMatchObject({
			organizationId: "org-1",
			manageableSubareaIds: ["coverage-area"],
			canManageCoverageSettings: false,
		});
	});
	it("lets a coverage-only manager open planning without loading or rendering templates", async () => {
		mocks.access.mockResolvedValue({
			organizationId: "org-1",
			canAccessShiftTemplates: false,
			canAccessCoverageRules: true,
			canManageCoverageSettings: false,
			manageableSubareaIds: new Set(["coverage-area"]),
		});
		const page = await renderPage();
		expect(page.props.defaultTab).toBe("coverage");
		expect(page.props.tabs.map((tab: { value: string }) => tab.value)).toEqual([
			"coverage",
		]);
		expect(mocks.locations).toHaveBeenCalledTimes(1);
	});
	it("keeps coverage hidden from a template-only actor", async () => {
		mocks.access.mockResolvedValue({
			organizationId: "org-1",
			canAccessShiftTemplates: true,
			canAccessCoverageRules: false,
			manageableShiftTemplateSubareaIds: new Set(["template-area"]),
		});
		const page = await renderPage();
		expect(page.props.tabs.map((tab: { value: string }) => tab.value)).toEqual([
			"templates",
		]);
		expect(mocks.locations).toHaveBeenCalledTimes(1);
	});
	it.each([
		null,
		{ canAccessShiftTemplates: false, canAccessCoverageRules: false },
	])("rejects actors without either planning permission", async (access) => {
		mocks.access.mockResolvedValue(access);
		await expect(renderPage()).rejects.toThrow("redirect:/settings");
		expect(mocks.locations).not.toHaveBeenCalled();
	});
	it("redirects the legacy coverage route to its tab with its original guard", async () => {
		await expect(LegacyCoveragePage().props.children.type()).rejects.toThrow(
			"redirect:/settings/shifts?tab=coverage",
		);
		mocks.access.mockResolvedValue({ canAccessCoverageRules: false });
		await expect(LegacyCoveragePage().props.children.type()).rejects.toThrow(
			"redirect:/settings",
		);
	});
});
