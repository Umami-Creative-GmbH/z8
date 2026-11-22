/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});
vi.mock("@/components/settings/project-management", () => ({
	ProjectManagement: ({ organizationId }: { organizationId: string }) => (
		<div data-testid="project-management">
			<span>{organizationId}</span>
			<input aria-label="Project filter" defaultValue="" />
		</div>
	),
}));
vi.mock("@/components/settings/project-template-management", () => ({
	ProjectTemplateManagement: ({ organizationId }: { organizationId: string }) => (
		<div data-testid="project-templates">{organizationId} templates</div>
	),
}));
vi.mock("@/components/settings/project-task-management", () => ({
	ProjectTaskManagement: () => <div data-testid="project-task-management" />,
}));

import ProjectSettingsPage from "./page";

async function renderContent() {
	return ProjectSettingsPage().props.children.type();
}

describe("ProjectSettingsPage feature-flag guard and SettingsTabbedPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/en/settings/projects");
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

	afterEach(() => {
		cleanup();
	});

	it("renders Projects and Templates via SettingsTabbedPage for org admins when projectsEnabled is on", async () => {
		const { container } = render(await renderContent());

		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
		expect(container.firstElementChild?.className).toContain("page-frame");
		expect(container.querySelector(".page-measure")).toBeNull();
		const tablist = screen.getByRole("tablist", { name: "Projects" });
		expect(tablist.parentElement?.className).toContain("max-w-full");
		expect(tablist.parentElement?.className).toContain("overflow-x-auto");
		expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByTestId("project-management")).toBeTruthy();
		expect(screen.queryByTestId("project-templates")).toBeNull();
	});

	it("supports ?tab=templates deep links, unknown-tab fallback, URL sync, and keepMounted state", async () => {
		window.history.replaceState(null, "", "/en/settings/projects?tab=templates");
		render(await renderContent());
		expect(screen.getByRole("tab", { name: "Templates" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByTestId("project-templates")).toBeTruthy();
		expect(screen.queryByTestId("project-management")).toBeNull();

		cleanup();
		window.history.replaceState(null, "", "/de/settings/projects?tab=unknown&from=nav#list");
		render(await renderContent());
		expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		fireEvent.change(screen.getByLabelText("Project filter"), {
			target: { value: "Apollo" },
		});

		fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
		await waitFor(() => expect(screen.getByTestId("project-templates")).toBeTruthy());
		expect(window.location.pathname).toBe("/de/settings/projects");
		expect(window.location.hash).toBe("#list");
		expect(new URLSearchParams(window.location.search).get("from")).toBe("nav");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("templates");

		fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe("Apollo"),
		);
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

		render(await renderContent());
		expect(mocks.requireOrganizationFeatureEnabled).toHaveBeenCalledWith(
			"org-1",
			"projectsEnabled",
		);
		expect(screen.getByTestId("project-task-management")).toBeTruthy();

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
