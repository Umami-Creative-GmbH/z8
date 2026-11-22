import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	requireOrganizationFeatureEnabled: vi.fn(),
	loadProjectTaskManager: vi.fn(),
	listProjectsWithManageableTasks: vi.fn(),
	redirectWithLocale: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mocks.getCurrentSettingsAccess,
}));
vi.mock("@/lib/settings/feature-flags.server", () => ({
	requireOrganizationFeatureEnabled: mocks.requireOrganizationFeatureEnabled,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("@/lib/projects/project-task-permission", () => ({
	loadProjectTaskManager: mocks.loadProjectTaskManager,
	listProjectsWithManageableTasks: mocks.listProjectsWithManageableTasks,
}));
vi.mock("@/components/settings/project-management", () => ({
	ProjectManagement: ({ organizationId }: { organizationId: string }) => (
		<div data-testid="project-management">{organizationId}</div>
	),
}));
vi.mock("@/components/settings/project-settings-tabs", () => ({
	ProjectSettingsTabs: ({ projects }: { projects: React.ReactNode }) => (
		<div data-testid="project-settings-tabs">{projects}</div>
	),
}));
vi.mock("@/components/settings/project-template-management", () => ({
	ProjectTemplateManagement: () => <div data-testid="project-templates" />,
}));
vi.mock("@/components/settings/project-task-management", () => ({
	ProjectTaskManagement: () => <div data-testid="project-task-management" />,
}));

import ProjectSettingsPage from "./page";

async function renderContent() {
	return ProjectSettingsPage().props.children.type();
}

describe("ProjectSettingsPage feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "orgAdmin",
			membershipRole: "admin",
			employee: null,
		});
		mocks.requireOrganizationFeatureEnabled.mockResolvedValue(undefined);
		mocks.loadProjectTaskManager.mockResolvedValue(null);
		mocks.listProjectsWithManageableTasks.mockResolvedValue([]);
	});

	it("renders project settings tabs for org admins when projectsEnabled is on", async () => {
		const html = renderToStaticMarkup(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
		expect(html).toContain("project-settings-tabs");
	});

	it("returns notFound for org admins and managers when projectsEnabled is off", async () => {
		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);

		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-2",
			organizationId: "org-1",
			settingsAccess: "scopedManager",
			membershipRole: "member",
			employee: { id: "emp-2", role: "manager" },
		});
		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("returns notFound for task-only project managers when projectsEnabled is off and renders when on", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-3",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: { id: "emp-3", role: "employee" },
		});
		mocks.loadProjectTaskManager.mockResolvedValue({ employeeId: "emp-3" });
		mocks.listProjectsWithManageableTasks.mockResolvedValue([{ id: "proj-1", name: "Alpha" }]);

		const html = renderToStaticMarkup(await renderContent());
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
		expect(html).toContain("project-task-management");

		mocks.requireOrganizationFeatureEnabled.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
		await expect(renderContent()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("redirects unauthorized members before checking the feature flag", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue({
			userId: "user-4",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: null,
		});

		await expect(renderContent()).rejects.toThrow("redirect:/settings");
		expect(mocks.requireOrganizationFeatureEnabled).not.toHaveBeenCalled();
	});
});
