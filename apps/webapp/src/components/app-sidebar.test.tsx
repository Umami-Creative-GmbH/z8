/* @vitest-environment jsdom */

import {
	IconBeach,
	IconGavel,
	IconHelp,
	IconMessageCircle,
	IconServerCog,
	IconShieldCheck,
} from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	navMainSpy,
	navSecondarySpy,
	navTeamSpy,
	appSearchSpy,
	appSidebarSpy,
	getUserOrganizationsMock,
	getAuthContextMock,
	getCurrentSettingsAccessTierMock,
	requireAbilityMock,
	canCreateOrganizationsForDeploymentMock,
	canViewWorksCouncilPortalMock,
	hasActivePayrollAccessGrantMock,
} = vi.hoisted(() => ({
	navMainSpy: vi.fn(),
	navSecondarySpy: vi.fn(),
	navTeamSpy: vi.fn(),
	appSearchSpy: vi.fn(),
	appSidebarSpy: vi.fn(),
	getUserOrganizationsMock: vi.fn(),
	getAuthContextMock: vi.fn(),
	getCurrentSettingsAccessTierMock: vi.fn(),
	requireAbilityMock: vi.fn(),
	canCreateOrganizationsForDeploymentMock: vi.fn(),
	canViewWorksCouncilPortalMock: vi.fn(),
	hasActivePayrollAccessGrantMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: null,
		isPending: false,
	}),
}));

vi.mock("@/lib/works-council/permissions", () => ({
	canViewWorksCouncilPortal: canViewWorksCouncilPortalMock,
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	hasActivePayrollAccessGrant: hasActivePayrollAccessGrantMock,
}));

vi.mock("@/components/nav-main", () => ({
	NavMain: ({ items }: { items: Array<{ title: string; url: string; icon: unknown }> }) => {
		navMainSpy(items);
		return (
			<nav aria-label="primary">
				{items.map((item) => (
					<a href={item.url} key={item.url}>
						{item.title}
					</a>
				))}
			</nav>
		);
	},
}));

vi.mock("@/components/app-search", () => ({
	AppSearch: ({
		staticCommands,
		staticResults,
	}: {
		staticCommands?: Array<{ href: string; id: string; title: string; type: string }>;
		staticResults: Array<{ href: string; title: string }>;
	}) => {
		appSearchSpy({ staticCommands, staticResults });
		return <button type="button">Search</button>;
	},
}));

vi.mock("@/components/nav-team", () => ({
	NavTeam: ({ items }: { items: Array<{ title: string; url: string; icon: unknown }> }) => {
		navTeamSpy(items);
		return <div data-testid="nav-team" />;
	},
}));

vi.mock("@/components/nav-user", () => ({
	NavUser: () => <div data-testid="nav-user" />,
}));

vi.mock("@/components/organization-switcher", () => ({
	OrganizationSwitcher: () => <div data-testid="organization-switcher" />,
}));

vi.mock("@/components/nav-secondary", () => ({
	NavSecondary: ({
		items,
	}: {
		items: Array<{ title: string; url: string; icon: unknown; external?: boolean }>;
	}) => {
		navSecondarySpy(items);

		return (
			<nav>
				{items.map((item) => (
					<a href={item.url} key={item.url}>
						{item.title}
					</a>
				))}
			</nav>
		);
	},
}));

vi.mock("@/components/ui/sidebar", () => ({
	Sidebar: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
	SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SidebarFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SidebarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AppSidebar } from "./app-sidebar";

describe("app sidebar compliance navigation", () => {
	beforeEach(() => {
		navMainSpy.mockClear();
		navSecondarySpy.mockClear();
		navTeamSpy.mockClear();
		appSearchSpy.mockClear();
		appSidebarSpy.mockReset();
		getUserOrganizationsMock.mockReset();
		getAuthContextMock.mockReset();
		getCurrentSettingsAccessTierMock.mockReset();
		requireAbilityMock.mockReset();
		canCreateOrganizationsForDeploymentMock.mockReset();
		canViewWorksCouncilPortalMock.mockReset();
		hasActivePayrollAccessGrantMock.mockReset();
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("renders My Requests as a primary personal navigation item", () => {
		render(<AppSidebar />);

		expect(screen.getByRole("link", { name: "My Requests" }).getAttribute("href")).toBe(
			"/my-requests",
		);
		expect(navMainSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ title: "My Requests", url: "/my-requests" }),
			]),
		);
	});

	it("orders Calendar after Time Tracking and before My Requests", () => {
		render(<AppSidebar />);

		expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url).slice(1, 4)).toEqual([
			"/time-tracking",
			"/calendar",
			"/my-requests",
		]);
	});

	it("renders Org Explorer as a primary personal navigation item", () => {
		render(<AppSidebar />);

		expect(screen.getByRole("link", { name: "Org Explorer" }).getAttribute("href")).toBe(
			"/organization",
		);
		expect(navMainSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ title: "Org Explorer", url: "/organization" }),
			]),
		);
	});

	it("renders Payroll navigation when payroll access is enabled", () => {
		render(<AppSidebar employeeRole="employee" showPayrollNav />);
		expect(screen.getByText("Payroll")).toBeTruthy();
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({ title: "Payroll", href: "/payroll" }),
				]),
				staticCommands: expect.arrayContaining([
					expect.objectContaining({ title: "Open payroll", href: "/payroll" }),
				]),
			}),
		);
	});

	it("hides Payroll navigation by default", () => {
		render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByText("Payroll")).toBeNull();
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.not.arrayContaining([expect.objectContaining({ href: "/payroll" })]),
				staticCommands: expect.not.arrayContaining([expect.objectContaining({ href: "/payroll" })]),
			}),
		);
	});

	it("renders search with member-safe static results and employee-safe command actions for employees", () => {
		render(
			<AppSidebar
				employeeRole="employee"
				featureFlags={{
					shiftsEnabled: false,
					projectsEnabled: false,
					surchargesEnabled: false,
					demoDataEnabled: false,
					worksCouncilEnabled: false,
				}}
				settingsAccessTier="member"
			/>,
		);

		expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({ title: "Dashboard", href: "/" }),
					expect.objectContaining({ title: "Profile", href: "/settings/profile" }),
				]),
			}),
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.not.arrayContaining([
					expect.objectContaining({ href: "/settings/employees" }),
					expect.objectContaining({ href: "/settings/organizations" }),
				]),
				staticCommands: expect.arrayContaining([
					expect.objectContaining({
						id: "action:add-manual-time-entry",
						title: "Add manual time entry",
					}),
					expect.objectContaining({ id: "action:request-absence", title: "Request absence" }),
					expect.objectContaining({
						id: "action:submit-travel-expense",
						title: "Submit travel expense",
					}),
					expect.objectContaining({ id: "action:open-my-requests", title: "Open my requests" }),
					expect.objectContaining({ id: "action:open-settings", title: "Open settings" }),
				]),
			}),
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticCommands: expect.not.arrayContaining([
					expect.objectContaining({ id: "action:open-approvals-inbox" }),
					expect.objectContaining({ id: "action:invite-teammate" }),
				]),
			}),
		);
	});

	it("passes the approvals command action for managers", () => {
		render(<AppSidebar employeeRole="manager" settingsAccessTier="member" />);

		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticCommands: expect.arrayContaining([
					expect.objectContaining({
						id: "action:open-approvals-inbox",
						title: "Open approvals inbox",
						href: "/approvals/inbox",
					}),
				]),
			}),
		);
	});

	it("renders surcharge settings search navigation when the organization feature flag is enabled", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: true,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: {
				role: "user",
			},
			session: { activeOrganizationId: "org_1" },
			employee: {
				organizationId: "org_1",
				role: "manager",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValue("manager");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({ title: "Surcharges", href: "/settings/surcharges" }),
				]),
			}),
		);
	});

	it("passes works council feature state from the active organization", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: true,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: { role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: { organizationId: "org_1", role: "admin" },
		});
		getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
		requireAbilityMock.mockResolvedValue({});
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(screen.getByRole("link", { name: "Works Council" }).getAttribute("href")).toBe(
			"/works-council",
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticCommands: expect.any(Array),
			}),
		);
		expect(requireAbilityMock).toHaveBeenCalledTimes(1);
		expect(canViewWorksCouncilPortalMock).toHaveBeenCalledWith({}, "org_1", "org_1");
	});

	it("uses the active organization for works council navigation when no employee exists", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: true,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: { role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: null,
		});
		getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
		requireAbilityMock.mockResolvedValue({});
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(screen.getByRole("link", { name: "Works Council" }).getAttribute("href")).toBe(
			"/works-council",
		);
		expect(requireAbilityMock).toHaveBeenCalledTimes(1);
		expect(canViewWorksCouncilPortalMock).toHaveBeenCalledWith({}, "org_1", "org_1");
	});

	it("hides works council navigation when the organization feature flag is disabled", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: { role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: { organizationId: "org_1", role: "admin" },
		});
		getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(screen.queryByRole("link", { name: "Works Council" })).toBeNull();
		expect(requireAbilityMock).not.toHaveBeenCalled();
		expect(canViewWorksCouncilPortalMock).not.toHaveBeenCalled();
	});

	it("renders Team Absences after Team for managers only", () => {
		const { rerender } = render(<AppSidebar employeeRole="manager" />);

		expect(navTeamSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ title: "Team Absences", url: "/team/absences", icon: IconBeach }),
			]),
		);
		expect(navTeamSpy.mock.lastCall?.[0].map((item) => item.url).slice(0, 2)).toEqual([
			"/team",
			"/team/absences",
		]);

		navTeamSpy.mockClear();
		rerender(<AppSidebar employeeRole="employee" />);

		expect(navTeamSpy).not.toHaveBeenCalled();
	});

	it("renders help and feedback entries in secondary navigation", () => {
		render(<AppSidebar />);

		expect(screen.getByRole("link", { name: "Get Help" }).getAttribute("href")).toBe(
			"https://docs.z8-time.app/docs",
		);
		expect(screen.getByRole("link", { name: "Feedback" }).getAttribute("href")).toBe(
			"https://github.com/Umami-Creative-GmbH/z8/issues",
		);
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Get Help",
					url: "https://docs.z8-time.app/docs",
					icon: IconHelp,
					external: true,
				}),
				expect.objectContaining({
					title: "Feedback",
					url: "https://github.com/Umami-Creative-GmbH/z8/issues",
					icon: IconMessageCircle,
					external: true,
				}),
			]),
		);
	});

	it("hides platform admin navigation by default", () => {
		render(<AppSidebar />);

		expect(screen.queryByRole("link", { name: "Platform Admin" })).toBeNull();
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					title: "Platform Admin",
					url: "/platform-admin",
				}),
			]),
		);
	});

	it("renders platform admin navigation below feedback when enabled", () => {
		render(<AppSidebar showPlatformAdminNav />);

		expect(screen.getByRole("link", { name: "Platform Admin" }).getAttribute("href")).toBe(
			"/platform-admin",
		);

		const secondaryItems = navSecondarySpy.mock.lastCall?.[0] ?? [];
		expect(secondaryItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Platform Admin",
					url: "/platform-admin",
					icon: IconServerCog,
				}),
			]),
		);
		expect(secondaryItems.map((item) => item.title).slice(-2)).toEqual([
			"Feedback",
			"Platform Admin",
		]);
	});

	it("renders the compliance entry in secondary nav only when enabled", () => {
		const { rerender } = render(<AppSidebar showComplianceNav />);

		expect(screen.getByRole("link", { name: "Compliance" }).getAttribute("href")).toBe(
			"/compliance",
		);
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Compliance",
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);

		rerender(<AppSidebar showComplianceNav={false} />);

		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);
	});

	it("renders works council navigation before settings only when enabled", () => {
		const { rerender } = render(<AppSidebar />);

		expect(screen.queryByRole("link", { name: "Works Council" })).toBeNull();
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					title: "Works Council",
					url: "/works-council",
				}),
			]),
		);

		rerender(<AppSidebar showWorksCouncilNav />);

		expect(screen.getByRole("link", { name: "Works Council" }).getAttribute("href")).toBe(
			"/works-council",
		);
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Works Council",
					url: "/works-council",
					icon: IconGavel,
				}),
			]),
		);

		const secondaryItems = navSecondarySpy.mock.lastCall?.[0] ?? [];
		expect(secondaryItems.map((item) => item.title).slice(0, 2)).toEqual([
			"Works Council",
			"Settings",
		]);
	});

	it("passes showComplianceNav from the org-admin settings tier at runtime", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: true,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: {
				role: "user",
			},
			session: { activeOrganizationId: "org_1" },
			employee: {
				id: "emp_admin",
				organizationId: "org_1",
				role: "admin",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("orgAdmin");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: (props: Record<string, unknown>) => {
				appSidebarSpy(props);
				return <div data-testid="server-sidebar-proxy" />;
			},
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(screen.getByTestId("server-sidebar-proxy")).toBeTruthy();
		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				showComplianceNav: true,
				showPayrollNav: true,
				showPlatformAdminNav: false,
				employeeRole: "admin",
				shiftsEnabled: true,
				settingsAccessTier: "orgAdmin",
				billingEnabled: false,
				canCreateOrganizations: false,
				featureFlags: {
					shiftsEnabled: true,
					projectsEnabled: false,
					surchargesEnabled: false,
					demoDataEnabled: true,
					worksCouncilEnabled: false,
				},
			}),
		);
		expect(hasActivePayrollAccessGrantMock).not.toHaveBeenCalled();

		appSidebarSpy.mockReset();
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				showComplianceNav: false,
				showPayrollNav: true,
				showPlatformAdminNav: false,
				settingsAccessTier: "member",
				billingEnabled: false,
				canCreateOrganizations: false,
				featureFlags: {
					shiftsEnabled: true,
					projectsEnabled: false,
					surchargesEnabled: false,
					demoDataEnabled: true,
					worksCouncilEnabled: false,
				},
			}),
		);
	});

	it("passes scoped payroll navigation for active employees with payroll access grants", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: { role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: {
				id: "emp_1",
				organizationId: "org_1",
				role: "employee",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");
		hasActivePayrollAccessGrantMock.mockResolvedValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: (props: Record<string, unknown>) => {
				appSidebarSpy(props);
				return <div data-testid="server-sidebar-proxy" />;
			},
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({ showPayrollNav: true, employeeRole: "employee" }),
		);
		expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			payrollEmployeeId: "emp_1",
		});
	});

	it("hides scoped payroll navigation for employees without active grants", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: { role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: {
				id: "emp_1",
				organizationId: "org_1",
				role: "employee",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: (props: Record<string, unknown>) => {
				appSidebarSpy(props);
				return <div data-testid="server-sidebar-proxy" />;
			},
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({ showPayrollNav: false, employeeRole: "employee" }),
		);
	});

	it("passes platform admin navigation from the authenticated platform role", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: true,
				worksCouncilEnabled: false,
			},
		]);
		getAuthContextMock.mockResolvedValue({
			user: {
				role: "admin",
			},
			session: { activeOrganizationId: "org_1" },
			employee: {
				organizationId: "org_1",
				role: "employee",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: (props: Record<string, unknown>) => {
				appSidebarSpy(props);
				return <div data-testid="server-sidebar-proxy" />;
			},
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(screen.getByTestId("server-sidebar-proxy")).toBeTruthy();
		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				showPlatformAdminNav: true,
				employeeRole: "employee",
				settingsAccessTier: "member",
				canCreateOrganizations: true,
			}),
		);
	});
});
