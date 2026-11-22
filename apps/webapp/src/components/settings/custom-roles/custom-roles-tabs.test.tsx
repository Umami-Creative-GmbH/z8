/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { CustomRolesManagement } from "./custom-roles-management";
import { TeamPermissionsTab } from "./team-permissions-tab";

const mocks = vi.hoisted(() => ({
	search: "",
	listCustomRoles: vi.fn(),
	deleteCustomRole: vi.fn(),
	loadPermissionsPageData: vi.fn(),
	translate: (_key: string, fallback: string, params?: Record<string, string | number>) =>
		Object.entries(params ?? {}).reduce(
			(text, [paramKey, paramValue]) => text.replace(`{${paramKey}}`, String(paramValue)),
			fallback,
		),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: mocks.translate,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/settings/roles/actions", () => ({
	listCustomRoles: mocks.listCustomRoles,
	deleteCustomRole: mocks.deleteCustomRole,
}));

vi.mock("@/app/[locale]/(app)/settings/permissions/actions", () => ({
	loadPermissionsPageData: mocks.loadPermissionsPageData,
	grantTeamPermissions: vi.fn(),
	revokeTeamPermissions: vi.fn(),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="user-avatar" />,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

function renderRolesTabbedPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ViewRefreshProvider>
				<SettingsTabbedPage
					title="Custom Roles"
					defaultTab="roles"
					tabs={[
						{
							value: "roles",
							label: "Custom Roles",
							description:
								"Create custom permission roles that can be assigned to employees. Custom roles add permissions on top of the base tier.",
							panel: <CustomRolesManagement organizationId="org-1" />,
						},
						{
							value: "team-permissions",
							label: "Team Permissions",
							description: "Manage employee permissions for team operations",
							panel: <TeamPermissionsTab organizationId="org-1" />,
						},
					]}
				/>
			</ViewRefreshProvider>
		</QueryClientProvider>,
	);
}

describe("Custom Roles and Team Permissions tabbed surface", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.search = "";
		window.history.replaceState(null, "", "/en/settings/roles");
		mocks.listCustomRoles.mockResolvedValue({
			success: true,
			data: [
				{
					id: "role-1",
					name: "Shift Lead",
					description: "Leads shifts",
					color: "#3b82f6",
					baseTier: "manager",
					permissions: [{ action: "read", subject: "Team" }],
					assignedCount: 2,
				},
			],
		});
		mocks.loadPermissionsPageData.mockResolvedValue({
			success: true,
			data: {
				organizationId: "org-1",
				employees: [
					{
						id: "emp-1",
						userId: "user-1",
						firstName: "Grace",
						lastName: "Hopper",
						pronouns: null,
						position: "Coordinator",
						role: "employee",
						isActive: true,
						teamId: null,
						user: {
							id: "user-1",
							firstName: "Grace",
							lastName: "Hopper",
							name: "Grace Hopper",
							email: "grace@example.test",
							image: null,
						},
						team: null,
					},
				],
				teams: [],
				permissions: [],
			},
		});
	});

	it("renders Custom Roles by default with one h1 and defers loading Team Permissions until selected", async () => {
		const replaceStateSpy = vi.spyOn(window.history, "replaceState");

		renderRolesTabbedPage();

		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(await screen.findByText("Shift Lead")).toBeTruthy();
		expect(mocks.loadPermissionsPageData).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("tab", { name: "Team Permissions" }));

		expect(replaceStateSpy).toHaveBeenCalledWith(
			null,
			"",
			"/en/settings/roles?tab=team-permissions",
		);
		expect(await screen.findByText("Grace Hopper")).toBeTruthy();
		expect(mocks.loadPermissionsPageData).toHaveBeenCalledOnce();
	});

	it("opens the Team Permissions tab directly when ?tab=team-permissions is present", async () => {
		mocks.search = "tab=team-permissions";

		renderRolesTabbedPage();

		expect(screen.getByText("Manage employee permissions for team operations")).toBeTruthy();
		expect(await screen.findByText("Grace Hopper")).toBeTruthy();
		expect(mocks.loadPermissionsPageData).toHaveBeenCalledOnce();
		expect(mocks.listCustomRoles).not.toHaveBeenCalled();
	});
});
