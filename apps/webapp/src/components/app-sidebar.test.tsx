/* @vitest-environment jsdom */

import {
	IconBeach,
	IconCalendarCheck,
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
	navOrganizationSpy,
	navSecondarySpy,
	navTeamSpy,
	appSearchSpy,
	appSidebarSpy,
	getUserOrganizationsMock,
	getAuthContextMock,
	getRenderSettingsAccessMock,
	getRenderOrganizationAbilityMock,
	requireAbilityMock,
	canCreateOrganizationsForDeploymentMock,
	canViewWorksCouncilPortalMock,
	hasActivePayrollAccessGrantMock,
	loadFinanceActorMock,
	loadCurrentPersonnelFileAccessMock,
	loadCollectsPeriodSubmissionsMock,
	listWhoIsInLocationsMock,
	readDrivingLicenceVisibilityMock,
	readEquipmentNavigationMock,
	hasTaskManagedProjectMock,
	hasActiveOrganizationShareLinksMock,
} = vi.hoisted(() => ({
	navMainSpy: vi.fn(),
	navOrganizationSpy: vi.fn(),
	navSecondarySpy: vi.fn(),
	navTeamSpy: vi.fn(),
	appSearchSpy: vi.fn(),
	appSidebarSpy: vi.fn(),
	getUserOrganizationsMock: vi.fn(),
	getAuthContextMock: vi.fn(),
	getRenderSettingsAccessMock: vi.fn(),
	getRenderOrganizationAbilityMock: vi.fn(),
	requireAbilityMock: vi.fn(),
	canCreateOrganizationsForDeploymentMock: vi.fn(),
	canViewWorksCouncilPortalMock: vi.fn(),
	hasActivePayrollAccessGrantMock: vi.fn(),
	loadFinanceActorMock: vi.fn(),
	loadCurrentPersonnelFileAccessMock: vi.fn(),
	loadCollectsPeriodSubmissionsMock: vi.fn(),
	listWhoIsInLocationsMock: vi.fn(),
	readDrivingLicenceVisibilityMock: vi.fn(),
	readEquipmentNavigationMock: vi.fn(),
	hasTaskManagedProjectMock: vi.fn(),
	hasActiveOrganizationShareLinksMock: vi.fn(),
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

vi.mock("@/lib/projects/project-manager-settings-access", () => ({
	managesProjectBelowManagerTierForIdentity: async () => false,
}));

vi.mock("@/lib/auth/render-context", () => ({
	getRenderAuthContext: getAuthContextMock,
	getRenderUserOrganizations: getUserOrganizationsMock,
	getRenderSettingsAccess: getRenderSettingsAccessMock,
	getRenderOrganizationAbility: async () => getRenderOrganizationAbilityMock(),
	getRenderAbility: async () => requireAbilityMock(),
	getRenderOrganizationIdentity: async () => {
		const context = await getAuthContextMock();
		return context?.session?.activeOrganizationId
			? {
					userId: context.user.id,
					organizationId: context.session.activeOrganizationId,
					membershipRole: "member",
					employee: context.employee ?? null,
				}
			: null;
	},
}));

vi.mock("@/lib/works-council/permissions", () => ({
	canViewWorksCouncilPortal: canViewWorksCouncilPortalMock,
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	hasActivePayrollAccessGrant: hasActivePayrollAccessGrantMock,
}));

vi.mock("@/lib/travel-expenses/finance-access", () => ({
	loadFinanceActorForIdentity: loadFinanceActorMock,
}));

vi.mock("@/lib/personnel-file/access-store", () => ({
	resolvePersonnelFileAccessForIdentity: async (...args: unknown[]) => {
		const current = await loadCurrentPersonnelFileAccessMock(...args);
		return current?.status === "resolved" ? current.access : null;
	},
}));

vi.mock("@/lib/time-tracking/period-submissions/settings", () => ({
	loadCollectsPeriodSubmissions: loadCollectsPeriodSubmissionsMock,
}));

vi.mock("@/lib/time-tracking/who-is-in/queries", () => ({
	hasWhoIsInLocations: async (...args: unknown[]) =>
		(await listWhoIsInLocationsMock(...args)).length > 0,
}));

vi.mock("@/lib/organization/driving-licence/visibility", () => ({
	readDrivingLicenceVisibilityForIdentity: readDrivingLicenceVisibilityMock,
	showsDrivingLicenceSettings: (view: { settings: string }) => view.settings !== "hidden",
}));

vi.mock("@/lib/projects/project-task-permission", () => ({
	hasTaskManagedProject: hasTaskManagedProjectMock,
}));

vi.mock("@/lib/projects/report-share/report-share-links", () => ({
	hasActiveOrganizationShareLinks: hasActiveOrganizationShareLinksMock,
}));

vi.mock("@/lib/organization/equipment/access", () => ({
	readEquipmentNavigation: readEquipmentNavigationMock,
}));

vi.mock("@/components/travel-expenses/finance/finance-nav-badge", () => ({
	FinanceNavBadge: () => <span>3</span>,
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
		staticCommands?: Array<{
			href: string;
			id: string;
			title: string;
			type: string;
		}>;
		staticResults: Array<{ href: string; title: string }>;
	}) => {
		appSearchSpy({ staticCommands, staticResults });
		return <button type="button">Search</button>;
	},
}));

vi.mock("@/components/nav-team", () => ({
	NavTeam: ({ items }: { items: Array<{ title: string; url: string; icon: unknown }> }) => {
		navTeamSpy(items);
		return (
			<nav aria-label="team" data-testid="nav-team">
				{items.map((item) => (
					<a href={item.url} key={item.url}>
						{item.title}
					</a>
				))}
			</nav>
		);
	},
}));

vi.mock("@/components/nav-organization", () => ({
	NavOrganization: ({
		items,
	}: {
		items: Array<{ title: string; url: string; icon: unknown; badge?: ReactNode }>;
	}) => {
		navOrganizationSpy(items);
		return (
			<nav aria-label="organization" data-testid="nav-organization">
				{items.map((item) => (
					<a href={item.url} key={item.url}>
						{item.title}
					</a>
				))}
			</nav>
		);
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
		items: Array<{
			title: string;
			url: string;
			icon: unknown;
			external?: boolean;
		}>;
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

function SidebarProxy(props: Record<string, unknown>) {
	appSidebarSpy(props);
	return <div data-testid="server-sidebar-proxy" />;
}
describe("app sidebar compliance navigation", () => {
	beforeEach(() => {
		navMainSpy.mockClear();
		navOrganizationSpy.mockClear();
		navSecondarySpy.mockClear();
		navTeamSpy.mockClear();
		appSearchSpy.mockClear();
		appSidebarSpy.mockReset();
		getUserOrganizationsMock.mockReset();
		getAuthContextMock.mockReset();
		getRenderSettingsAccessMock.mockReset();
		getRenderOrganizationAbilityMock.mockReset();
		getRenderOrganizationAbilityMock.mockResolvedValue(null);
		hasTaskManagedProjectMock.mockReset();
		hasTaskManagedProjectMock.mockResolvedValue(false);
		hasActiveOrganizationShareLinksMock.mockReset();
		hasActiveOrganizationShareLinksMock.mockResolvedValue(false);
		requireAbilityMock.mockReset();
		canCreateOrganizationsForDeploymentMock.mockReset();
		canViewWorksCouncilPortalMock.mockReset();
		hasActivePayrollAccessGrantMock.mockReset();
		loadFinanceActorMock.mockReset();
		loadCurrentPersonnelFileAccessMock.mockReset();
		loadCollectsPeriodSubmissionsMock.mockReset();
		loadCollectsPeriodSubmissionsMock.mockResolvedValue(false);
		listWhoIsInLocationsMock.mockReset();
		listWhoIsInLocationsMock.mockResolvedValue([]);
		readDrivingLicenceVisibilityMock.mockReset();
		readEquipmentNavigationMock.mockReset();
		readEquipmentNavigationMock.mockResolvedValue({
			personal: false,
			staff: false,
		});
		readDrivingLicenceVisibilityMock.mockResolvedValue({
			featureEnabled: false,
			intendedDriver: false,
			ownRetainedRecords: false,
			verifier: false,
			planner: false,
			settings: "hidden",
		});
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

	it("orders personal navigation items", () => {
		render(<AppSidebar />);

		expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url)).toEqual([
			"/",
			"/time-tracking",
			"/calendar",
			"/absences",
			"/travel-expenses",
			"/my-requests",
			"/reports",
			"/organization",
		]);
	});

	it("renders My Documents after My Requests only while personnel files are on (#865)", () => {
		const { unmount } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "My Documents" })).toBeNull();
		unmount();

		render(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					myDocuments: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "My Documents" }).getAttribute("href")).toBe(
			"/my-documents",
		);
		const urls = navMainSpy.mock.lastCall?.[0].map((item) => item.url) ?? [];
		expect(urls.indexOf("/my-documents")).toBe(urls.indexOf("/my-requests") + 1);
	});

	it("renders Personnel Files in Organization only with the capability (#866, #1953)", () => {
		const { unmount } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "Personnel Files" })).toBeNull();
		expect(screen.queryByTestId("nav-organization")).toBeNull();
		unmount();

		render(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					myDocuments: true,
					personnelFiles: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "Personnel Files" }).getAttribute("href")).toBe(
			"/personnel-files",
		);
		expect(navMainSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).not.toContain(
			"/personnel-files",
		);
		expect(
			navOrganizationSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url),
		).toContain("/personnel-files");
	});

	it("renders My driving licence in Workplace after My Documents only with the capability (#1420, #1937, #1953)", () => {
		const { unmount } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "My driving licence" })).toBeNull();
		unmount();

		render(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					myDocuments: true,
					personnelFiles: true,
					myDrivingLicence: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "My driving licence" }).getAttribute("href")).toBe(
			"/driving-licence",
		);
		const urls = navMainSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url) ?? [];
		expect(urls.indexOf("/driving-licence")).toBe(urls.indexOf("/my-documents") + 1);
		expect(screen.queryByRole("link", { name: "Driving licences" })).toBeNull();
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({
						title: "My driving licence",
						href: "/driving-licence",
					}),
				]),
			}),
		);
	});

	it("shows Organization with Driving licences (and hides empty Team) to a verifier who is no manager (#1937, #1953)", () => {
		render(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: true,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					teamDrivingLicence: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.queryByTestId("nav-team")).toBeNull();
		expect(screen.getByTestId("nav-organization")).toBeTruthy();
		expect(
			navOrganizationSpy.mock.lastCall?.[0].map(
				({ title, url }: { title: string; url: string }) => ({
					title,
					url,
				}),
			),
		).toEqual([{ title: "Driving licences", url: "/team/driving-licence" }]);
	});

	it("places Driving licences in Organization for managers while Team leads with Today (#1937, #1953)", () => {
		const { unmount } = render(<AppSidebar employeeRole="manager" />);
		expect(navTeamSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).not.toContain(
			"/team/driving-licence",
		);
		expect(screen.queryByTestId("nav-organization")).toBeNull();
		unmount();

		render(
			<AppSidebar
				employeeRole="manager"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					teamDrivingLicence: true,
					platformAdmin: false,
				}}
			/>,
		);

		const teamUrls = navTeamSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url) ?? [];
		expect(teamUrls[0]).toBe("/today");
		expect(teamUrls.at(-2)).toBe("/approvals/inbox");
		expect(teamUrls.at(-1)).toBe("/analytics");
		expect(teamUrls).not.toContain("/team/driving-licence");
		expect(navOrganizationSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).toEqual([
			"/team/driving-licence",
		]);
	});

	it("hides empty Team and Organization sections from a plain employee without grants (#1953)", () => {
		render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByTestId("nav-team")).toBeNull();
		expect(screen.queryByTestId("nav-organization")).toBeNull();
	});

	it.each([
		[
			"shows",
			true,
			{
				status: "resolved",
				access: { grants: [{ categories: new Set(["payslip"]) }] },
			},
			true,
		],
		["hides", true, { status: "resolved", access: { grants: [] } }, false],
		["hides", true, { status: "unavailable" }, false],
		[
			"hides",
			false,
			{
				status: "resolved",
				access: { grants: [{ categories: new Set(["payslip"]) }] },
			},
			false,
		],
	])(
		"%s Personnel Files navigation from the personnel file access resolver (flag %s, #866)",
		async (_verb, enabled, current, personnelFiles) => {
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
					personnelFilesEnabled: enabled,
				},
			]);
			getAuthContextMock.mockResolvedValue({
				user: { role: "user" },
				session: { activeOrganizationId: "org_1" },
				employee: { id: "emp_1", organizationId: "org_1", role: "employee" },
			});
			getRenderSettingsAccessMock.mockResolvedValueOnce("member");
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(null);
			loadCurrentPersonnelFileAccessMock.mockResolvedValue(current);

			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));
			vi.doMock("./app-sidebar", () => ({
				AppSidebar: SidebarProxy,
			}));

			try {
				const { ServerAppSidebar } = await import("./server-app-sidebar");

				render(await ServerAppSidebar({}));

				expect(appSidebarSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						navigationCapabilities: expect.objectContaining({ personnelFiles }),
					}),
				);
				if (!enabled) expect(loadCurrentPersonnelFileAccessMock).not.toHaveBeenCalled();
			} finally {
				// Later tests render the real sidebar through the server component.
				vi.doUnmock("./app-sidebar");
			}
		},
	);

	it.each([
		[
			"intended driver",
			{ featureEnabled: true, intendedDriver: true, settings: "hidden" },
			{ myDrivingLicence: true, teamDrivingLicence: false },
			false,
		],
		[
			"verifier",
			{ featureEnabled: true, verifier: true, settings: "hidden" },
			{ myDrivingLicence: false, teamDrivingLicence: true },
			false,
		],
		[
			"planner",
			{ featureEnabled: true, planner: true, settings: "hidden" },
			{ myDrivingLicence: false, teamDrivingLicence: true },
			false,
		],
		[
			"verifier who is also an intended driver",
			{
				featureEnabled: true,
				intendedDriver: true,
				verifier: true,
				settings: "full",
			},
			{ myDrivingLicence: true, teamDrivingLicence: true },
			true,
		],
		[
			"former intended driver",
			{ featureEnabled: true, ownRetainedRecords: true, settings: "full" },
			{ myDrivingLicence: true, teamDrivingLicence: false },
			true,
		],
		[
			"member without a role",
			{ featureEnabled: true, settings: "full" },
			{ myDrivingLicence: false, teamDrivingLicence: false },
			true,
		],
		[
			"feature off",
			{ featureEnabled: false, settings: "retention_only" },
			{ myDrivingLicence: false, teamDrivingLicence: false },
			true,
		],
		[
			"feature off without records",
			{ featureEnabled: false, settings: "hidden" },
			{ myDrivingLicence: false, teamDrivingLicence: false },
			false,
		],
	])(
		"decides the Driving licence items and settings entry from the visibility reader (%s, #1420, #1937)",
		async (_case, view, items, drivingLicenceSettingsVisible) => {
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
					personnelFilesEnabled: false,
				},
			]);
			getAuthContextMock.mockResolvedValue({
				user: { id: "user_1", role: "user" },
				session: { activeOrganizationId: "org_1" },
				employee: { id: "emp_1", organizationId: "org_1", role: "employee" },
			});
			getRenderSettingsAccessMock.mockResolvedValueOnce("orgAdmin");
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(null);
			readDrivingLicenceVisibilityMock.mockResolvedValue({
				featureEnabled: false,
				intendedDriver: false,
				ownRetainedRecords: false,
				verifier: false,
				planner: false,
				...view,
			});

			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));
			vi.doMock("./app-sidebar", () => ({
				AppSidebar: SidebarProxy,
			}));

			try {
				const { ServerAppSidebar } = await import("./server-app-sidebar");

				render(await ServerAppSidebar({}));

				expect(readDrivingLicenceVisibilityMock).toHaveBeenCalledWith(
					expect.objectContaining({
						organizationId: "org_1",
						userId: "user_1",
					}),
				);
				expect(appSidebarSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						navigationCapabilities: expect.objectContaining(items),
						settingsCapabilities: expect.objectContaining({
							canManageDrivingLicence: drivingLicenceSettingsVisible,
						}),
					}),
				);
			} finally {
				vi.doUnmock("./app-sidebar");
			}
		},
	);

	it("renders Org Explorer as a primary personal navigation item", () => {
		render(<AppSidebar />);

		expect(screen.getByRole("link", { name: "Org Explorer" }).getAttribute("href")).toBe(
			"/organization",
		);
		expect(navMainSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Org Explorer",
					url: "/organization",
				}),
			]),
		);
	});

	it("renders Payroll navigation when payroll access is enabled", () => {
		render(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: true,
					worksCouncil: false,
					platformAdmin: false,
				}}
			/>,
		);
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
				settingsAccess="member"
			/>,
		);

		expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({ title: "Dashboard", href: "/" }),
					expect.objectContaining({
						title: "Profile",
						href: "/settings/profile",
					}),
				]),
			}),
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.not.arrayContaining([
					expect.objectContaining({ href: "/settings/employees" }),
					expect.objectContaining({ href: "/settings/organization" }),
				]),
				staticCommands: expect.arrayContaining([
					expect.objectContaining({
						id: "action:add-manual-time-entry",
						title: "Add manual time entry",
					}),
					expect.objectContaining({
						id: "action:request-absence",
						title: "Request absence",
					}),
					expect.objectContaining({
						id: "action:submit-travel-expense",
						title: "Submit travel expense",
					}),
					expect.objectContaining({
						id: "action:open-my-requests",
						title: "Open my requests",
					}),
					expect.objectContaining({
						id: "action:open-settings",
						title: "Open settings",
					}),
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
		render(<AppSidebar employeeRole="manager" settingsAccess="member" />);

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
		getRenderSettingsAccessMock.mockResolvedValue("scopedManager");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
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
					expect.objectContaining({
						title: "Surcharges",
						href: "/settings/surcharges",
					}),
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
		getRenderSettingsAccessMock.mockResolvedValue("orgAdmin");
		requireAbilityMock.mockResolvedValue({});
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
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
		expect(requireAbilityMock).toHaveBeenCalled();
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
		getRenderSettingsAccessMock.mockResolvedValue("orgAdmin");
		requireAbilityMock.mockResolvedValue({});
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
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
		expect(requireAbilityMock).toHaveBeenCalled();
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
		getRenderSettingsAccessMock.mockResolvedValue("orgAdmin");
		canViewWorksCouncilPortalMock.mockReturnValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(screen.queryByRole("link", { name: "Works Council" })).toBeNull();
		expect(canViewWorksCouncilPortalMock).not.toHaveBeenCalled();
		expect(canViewWorksCouncilPortalMock).not.toHaveBeenCalled();
	});

	it("gives employees their own schedule after Calendar only while shifts are on (#977)", () => {
		const capabilities = {
			scheduling: true,
			compliance: false,
			payroll: false,
			finance: false,
			worksCouncil: false,
			platformAdmin: false,
		};
		const { rerender } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "My Schedule" })).toBeNull();

		rerender(<AppSidebar employeeRole="employee" navigationCapabilities={capabilities} />);

		expect(screen.getByRole("link", { name: "My Schedule" }).getAttribute("href")).toBe(
			"/scheduling",
		);
		const urls = navMainSpy.mock.lastCall?.[0].map((item) => item.url) ?? [];
		expect(urls.indexOf("/scheduling")).toBe(urls.indexOf("/calendar") + 1);
		expect(navTeamSpy).not.toHaveBeenCalled();
	});

	it("keeps Scheduling in the Team section for managers, not in their personal section (#977)", () => {
		render(
			<AppSidebar
				employeeRole="manager"
				navigationCapabilities={{
					scheduling: true,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					platformAdmin: false,
				}}
			/>,
		);

		expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url)).not.toContain("/scheduling");
		expect(navTeamSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ title: "Scheduling", url: "/scheduling" }),
			]),
		);
	});

	it.each(["manager", "admin"] as const)(
		"shows Who Is In for %s only while the active organization has active locations",
		(role) => {
			const capabilities = {
				scheduling: false,
				compliance: false,
				payroll: false,
				finance: false,
				worksCouncil: false,
				platformAdmin: false,
				teamPresence: false,
			};
			const { rerender } = render(<AppSidebar employeeRole={role} />);
			expect(navTeamSpy.mock.lastCall?.[0].map((item) => item.url)).not.toContain("/team/presence");
			rerender(
				<AppSidebar
					employeeRole={role}
					navigationCapabilities={{ ...capabilities, teamPresence: true }}
				/>,
			);
			expect(navTeamSpy.mock.lastCall?.[0]).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						title: "Who Is In",
						url: "/team/presence",
					}),
				]),
			);
			rerender(<AppSidebar employeeRole={role} navigationCapabilities={capabilities} />);
			expect(navTeamSpy.mock.lastCall?.[0].map((item) => item.url)).not.toContain("/team/presence");
		},
	);

	it.each([
		["manager", "org_1", [], false],
		["manager", "org_1", [{ id: "loc_1", name: "Office" }], true],
		["admin", "org_1", [{ id: "loc_1", name: "Office" }], true],
		["employee", "org_1", [{ id: "loc_1", name: "Office" }], false],
		["manager", null, [{ id: "loc_1", name: "Office" }], false],
	] as const)(
		"resolves Who Is In visibility for %s in %s with locations %j",
		async (role, activeOrganizationId, locations, teamPresence) => {
			getUserOrganizationsMock.mockResolvedValue([{ id: "org_1" }]);
			getAuthContextMock.mockResolvedValue({
				user: { id: "user_1", role: "user" },
				session: { activeOrganizationId },
				employee: { id: "emp_1", organizationId: "org_1", role },
			});
			getRenderSettingsAccessMock.mockResolvedValue(
				role === "admin" ? "orgAdmin" : role === "manager" ? "scopedManager" : "member",
			);
			listWhoIsInLocationsMock.mockResolvedValue(locations);
			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));
			vi.doMock("./app-sidebar", () => ({
				AppSidebar: SidebarProxy,
			}));
			try {
				const { ServerAppSidebar } = await import("./server-app-sidebar");
				render(await ServerAppSidebar({}));
				expect(appSidebarSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						navigationCapabilities: expect.objectContaining({ teamPresence }),
					}),
				);
				if (role !== "employee" && activeOrganizationId)
					expect(listWhoIsInLocationsMock).toHaveBeenCalledWith(expect.anything(), {
						organizationId: "org_1",
					});
				else expect(listWhoIsInLocationsMock).not.toHaveBeenCalled();
			} finally {
				vi.doUnmock("./app-sidebar");
			}
		},
	);

	it("renders Period Submissions in the Team section only while the organization collects them (#1075)", () => {
		const { rerender } = render(<AppSidebar employeeRole="manager" />);
		expect(navTeamSpy.mock.lastCall?.[0].map((item) => item.url)).not.toContain(
			"/team/period-submissions",
		);

		rerender(
			<AppSidebar
				employeeRole="manager"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: false,
					periodSubmissions: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(navTeamSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Period Submissions",
					url: "/team/period-submissions",
					icon: IconCalendarCheck,
				}),
			]),
		);
	});

	it.each([
		["shows", "manager", true, true],
		["shows", "admin", true, true],
		["hides", "manager", false, false],
		["hides", "employee", true, false],
	] as const)(
		"%s Period Submissions navigation for role %s while collecting is %s (#1075)",
		async (_verb, role, collects, periodSubmissions) => {
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
				employee: { id: "emp_1", organizationId: "org_1", role },
			});
			getRenderSettingsAccessMock.mockResolvedValueOnce(
				role === "admin" ? "orgAdmin" : role === "manager" ? "scopedManager" : "member",
			);
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(null);
			loadCollectsPeriodSubmissionsMock.mockResolvedValue(collects);

			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));
			vi.doMock("./app-sidebar", () => ({
				AppSidebar: SidebarProxy,
			}));

			try {
				const { ServerAppSidebar } = await import("./server-app-sidebar");

				render(await ServerAppSidebar({}));

				expect(appSidebarSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						navigationCapabilities: expect.objectContaining({
							periodSubmissions,
						}),
					}),
				);
				if (role === "employee") {
					expect(loadCollectsPeriodSubmissionsMock).not.toHaveBeenCalled();
				} else {
					// Scoped to the session's active organization.
					expect(loadCollectsPeriodSubmissionsMock).toHaveBeenCalledWith(
						expect.anything(),
						"org_1",
						expect.anything(),
					);
				}
			} finally {
				vi.doUnmock("./app-sidebar");
			}
		},
	);

	it("renders Today first, then Team and Team Absences for managers only (#1953)", () => {
		const { rerender } = render(<AppSidebar employeeRole="manager" />);

		expect(navTeamSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Today",
					url: "/today",
				}),
				expect.objectContaining({
					title: "Team Absences",
					url: "/team/absences",
					icon: IconBeach,
				}),
			]),
		);
		expect(
			navTeamSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url).slice(0, 3),
		).toEqual(["/today", "/team", "/team/absences"]);

		navTeamSpy.mockClear();
		rerender(<AppSidebar employeeRole="employee" />);

		expect(navTeamSpy).not.toHaveBeenCalled();
	});

	it("renders Expense Finance in Organization with its count only when enabled (#753, #1952, #1953)", () => {
		const { rerender } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "Expense Finance" })).toBeNull();

		rerender(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: true,
					worksCouncil: false,
					platformAdmin: false,
				}}
			/>,
		);
		expect(screen.getByRole("link", { name: "Expense Finance" }).getAttribute("href")).toBe(
			"/travel-expenses/finance",
		);
		expect(navMainSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).not.toContain(
			"/travel-expenses/finance",
		);
		const orgItems = navOrganizationSpy.mock.lastCall?.[0] ?? [];
		expect(orgItems.map((item: { url: string }) => item.url)).toEqual(["/travel-expenses/finance"]);
		expect(orgItems[0]?.badge).toBeTruthy();
	});

	it.each([
		["shows", { canRead: true }, true],
		["hides", { canRead: false }, false],
		["hides", null, false],
	])(
		"%s Finance navigation from the finance actor's read access (#753)",
		async (_verb, actor, finance) => {
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
				employee: { id: "emp_1", organizationId: "org_1", role: "employee" },
			});
			getRenderSettingsAccessMock.mockResolvedValueOnce("member");
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(actor);

			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));
			vi.doMock("./app-sidebar", () => ({
				AppSidebar: SidebarProxy,
			}));

			const { ServerAppSidebar } = await import("./server-app-sidebar");

			render(await ServerAppSidebar({}));

			expect(appSidebarSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					navigationCapabilities: expect.objectContaining({ finance }),
				}),
			);
		},
	);

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
		render(
			<AppSidebar
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					worksCouncil: false,
					platformAdmin: true,
				}}
			/>,
		);

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

	it("renders Compliance in Organization and keeps secondary footer utility-only (#1953)", () => {
		const { rerender } = render(
			<AppSidebar
				navigationCapabilities={{
					scheduling: false,
					compliance: true,
					payroll: false,
					finance: false,
					worksCouncil: false,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "Compliance" }).getAttribute("href")).toBe(
			"/compliance",
		);
		expect(navOrganizationSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Compliance",
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);
		expect(navSecondarySpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).toEqual([
			"/settings",
			"https://docs.z8-time.app/docs",
			"https://github.com/Umami-Creative-GmbH/z8/issues",
		]);

		rerender(<AppSidebar />);

		expect(screen.queryByRole("link", { name: "Compliance" })).toBeNull();
		expect(screen.queryByTestId("nav-organization")).toBeNull();
	});

	it("renders Works Council in Organization only when enabled (#1953)", () => {
		const { rerender } = render(<AppSidebar />);

		expect(screen.queryByRole("link", { name: "Works Council" })).toBeNull();
		expect(screen.queryByTestId("nav-organization")).toBeNull();

		rerender(
			<AppSidebar
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					finance: false,
					worksCouncil: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(screen.getByRole("link", { name: "Works Council" }).getAttribute("href")).toBe(
			"/works-council",
		);
		expect(navOrganizationSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Works Council",
					url: "/works-council",
					icon: IconGavel,
				}),
			]),
		);
		expect(navSecondarySpy.mock.lastCall?.[0].map((item: { title: string }) => item.title)).toEqual(
			["Settings", "Get Help", "Feedback"],
		);
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
		getRenderSettingsAccessMock.mockResolvedValueOnce("orgAdmin");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(screen.getByTestId("server-sidebar-proxy")).toBeTruthy();
		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({
					compliance: true,
					payroll: true,
					platformAdmin: false,
					scheduling: true,
				}),
				employeeRole: "admin",
				settingsAccess: "orgAdmin",
				billingEnabled: false,
				canCreateOrganizations: false,
				featureFlags: {
					shiftsEnabled: true,
					projectsEnabled: false,
					surchargesEnabled: false,
					demoDataEnabled: true,
					worksCouncilEnabled: false,
					billableTimeEnabled: false,
					personnelFilesEnabled: false,
					equipmentEnabled: false,
				},
			}),
		);
		expect(hasActivePayrollAccessGrantMock).not.toHaveBeenCalled();

		appSidebarSpy.mockReset();
		getRenderSettingsAccessMock.mockResolvedValueOnce("member");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({
					compliance: false,
					payroll: false,
					platformAdmin: false,
					scheduling: true,
				}),
				settingsAccess: "member",
				billingEnabled: false,
				canCreateOrganizations: false,
				featureFlags: {
					shiftsEnabled: true,
					projectsEnabled: false,
					surchargesEnabled: false,
					demoDataEnabled: true,
					worksCouncilEnabled: false,
					billableTimeEnabled: false,
					personnelFilesEnabled: false,
					equipmentEnabled: false,
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
		getRenderSettingsAccessMock.mockResolvedValueOnce("member");
		hasActivePayrollAccessGrantMock.mockResolvedValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({ payroll: true }),
				employeeRole: "employee",
			}),
		);
		expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			payrollEmployeeId: "emp_1",
		});
	});

	it("shows payroll navigation for org admins without requiring an active payroll self-grant (#1957)", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				name: "Org",
				slug: "org",
				logo: null,
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
				id: "employee-admin",
				organizationId: "org_1",
				role: "admin",
			},
		});
		getRenderSettingsAccessMock.mockResolvedValue("orgAdmin");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));
		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({ payroll: true }),
				employeeRole: "admin",
			}),
		);
		expect(hasActivePayrollAccessGrantMock).not.toHaveBeenCalled();
	});

	it("shows payroll navigation for org admins without an employee record (#1957)", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
		getUserOrganizationsMock.mockResolvedValue([
			{
				id: "org_1",
				name: "Org",
				slug: "org",
				logo: null,
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
			employee: null,
		});
		getRenderSettingsAccessMock.mockResolvedValue("orgAdmin");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));
		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({ payroll: true }),
				employeeRole: null,
			}),
		);
		expect(hasActivePayrollAccessGrantMock).not.toHaveBeenCalled();
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
		getRenderSettingsAccessMock.mockResolvedValueOnce("member");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({ payroll: false }),
				employeeRole: "employee",
			}),
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
		getRenderSettingsAccessMock.mockResolvedValueOnce("member");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(screen.getByTestId("server-sidebar-proxy")).toBeTruthy();
		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({
					platformAdmin: true,
				}),
				employeeRole: "employee",
				settingsAccess: "member",
				canCreateOrganizations: true,
			}),
		);
	});

	it.each([
		{
			persona: "plain employee",
			role: "employee" as const,
			access: "member" as const,
			grants: {},
			expectedTeam: null,
			expectedOrg: null,
		},
		{
			persona: "manager",
			role: "manager" as const,
			access: "scopedManager" as const,
			grants: { shiftsEnabled: true },
			expectedTeam: [
				"/today",
				"/team",
				"/team/absences",
				"/scheduling",
				"/approvals/inbox",
				"/analytics",
			],
			expectedOrg: null,
		},
		{
			persona: "workforce admin",
			role: "admin" as const,
			access: "scopedManager" as const,
			grants: { shiftsEnabled: true },
			expectedTeam: [
				"/today",
				"/team",
				"/team/absences",
				"/scheduling",
				"/approvals/inbox",
				"/analytics",
			],
			expectedOrg: null,
		},
		{
			persona: "org admin with employee record",
			role: "admin" as const,
			access: "orgAdmin" as const,
			grants: {
				finance: true,
				personnelFiles: true,
				equipment: true,
				worksCouncil: true,
			},
			expectedTeam: ["/today", "/team", "/team/absences", "/approvals/inbox", "/analytics"],
			expectedOrg: [
				"/payroll",
				"/travel-expenses/finance",
				"/personnel-files",
				"/equipment",
				"/compliance",
				"/works-council",
			],
		},
		{
			persona: "org admin with employee record and payroll grant",
			role: "admin" as const,
			access: "orgAdmin" as const,
			grants: {
				payroll: true,
				finance: true,
				personnelFiles: true,
				equipment: true,
				worksCouncil: true,
			},
			expectedTeam: ["/today", "/team", "/team/absences", "/approvals/inbox", "/analytics"],
			expectedOrg: [
				"/payroll",
				"/travel-expenses/finance",
				"/personnel-files",
				"/equipment",
				"/compliance",
				"/works-council",
			],
		},
		{
			persona: "org admin without employee record",
			role: null,
			access: "orgAdmin" as const,
			grants: {
				personnelFiles: true,
				equipment: true,
				worksCouncil: true,
				projectsEnabled: true,
				billableTimeEnabled: true,
			},
			expectedTeam: ["/analytics"],
			expectedOrg: [
				"/payroll",
				"/billable-time/hand-off",
				"/personnel-files",
				"/equipment",
				"/compliance",
				"/works-council",
			],
		},
		{
			persona: "payroll officer",
			role: "employee" as const,
			access: "member" as const,
			grants: { payroll: true },
			expectedTeam: null,
			expectedOrg: ["/payroll"],
		},
		{
			persona: "close-month-only custom-role holder",
			role: "employee" as const,
			access: "member" as const,
			grants: { canCloseMonths: true },
			expectedTeam: null,
			expectedOrg: ["/payroll"],
		},
		{
			persona: "expense officer",
			role: "employee" as const,
			access: "member" as const,
			grants: {
				finance: true,
				projectsEnabled: true,
				billableTimeEnabled: true,
			},
			expectedTeam: null,
			expectedOrg: ["/travel-expenses/finance"],
		},
		{
			persona: "driving licence verifier",
			role: "employee" as const,
			access: "member" as const,
			grants: { teamDrivingLicence: true },
			expectedTeam: null,
			expectedOrg: ["/team/driving-licence"],
		},
		{
			persona: "equipment staff",
			role: "employee" as const,
			access: "member" as const,
			grants: { equipment: true, myEquipment: true },
			expectedTeam: null,
			expectedOrg: ["/equipment"],
		},
		{
			persona: "works council viewer",
			role: "employee" as const,
			access: "member" as const,
			grants: { worksCouncil: true },
			expectedTeam: null,
			expectedOrg: ["/works-council"],
		},
	])(
		"renders the four-section sidebar matrix for $persona (#1953)",
		async ({ role, access, grants, expectedTeam, expectedOrg }) => {
			vi.stubEnv("BILLING_ENABLED", "false");
			canCreateOrganizationsForDeploymentMock.mockImplementation((value: boolean) => value);
			getUserOrganizationsMock.mockResolvedValue([
				{
					id: "org_1",
					shiftsEnabled: Boolean(grants.shiftsEnabled),
					projectsEnabled: Boolean(grants.projectsEnabled),
					surchargesEnabled: false,
					demoDataEnabled: false,
					worksCouncilEnabled: Boolean(grants.worksCouncil),
					billableTimeEnabled: Boolean(grants.billableTimeEnabled),
					personnelFilesEnabled: Boolean(grants.personnelFiles),
					equipmentEnabled: Boolean(grants.equipment || grants.myEquipment),
				},
			]);
			getAuthContextMock.mockResolvedValue({
				user: { id: "user_1", role: "user" },
				session: { activeOrganizationId: "org_1" },
				employee: role ? { id: "emp_1", organizationId: "org_1", role } : null,
			});
			getRenderSettingsAccessMock.mockResolvedValueOnce(access);
			hasActivePayrollAccessGrantMock.mockResolvedValue(Boolean(grants.payroll));
			loadFinanceActorMock.mockResolvedValue(grants.finance ? { canRead: true } : null);
			loadCurrentPersonnelFileAccessMock.mockResolvedValue(
				grants.personnelFiles
					? { status: "resolved", access: { grants: [{ categories: new Set(["payslip"]) }] } }
					: { status: "resolved", access: { grants: [] } },
			);
			readEquipmentNavigationMock.mockResolvedValue({
				personal: Boolean(grants.myEquipment),
				staff: Boolean(grants.equipment),
			});
			readDrivingLicenceVisibilityMock.mockResolvedValue({
				featureEnabled: Boolean(grants.teamDrivingLicence),
				intendedDriver: false,
				ownRetainedRecords: false,
				verifier: Boolean(grants.teamDrivingLicence),
				planner: false,
				settings: "hidden",
			});
			const abilityMock = {
				can: (action: string, subject: string) =>
					Boolean(grants.canCloseMonths) && action === "close" && subject === "PayrollPeriod",
			};
			requireAbilityMock.mockResolvedValue(abilityMock);
			getRenderOrganizationAbilityMock.mockResolvedValueOnce(abilityMock);
			canViewWorksCouncilPortalMock.mockReturnValue(Boolean(grants.worksCouncil));

			vi.doUnmock("./app-sidebar");
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
			}));

			const { ServerAppSidebar } = await import("./server-app-sidebar");
			render(await ServerAppSidebar({ showWorksCouncilNav: true }));

			// Workplace never contains officer/organization consoles
			const workplaceUrls =
				navMainSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url) ?? [];
			for (const forbidden of [
				"/payroll",
				"/travel-expenses/finance",
				"/personnel-files",
				"/equipment",
				"/team/driving-licence",
				"/compliance",
				"/works-council",
			]) {
				expect(workplaceUrls).not.toContain(forbidden);
			}

			// Footer is strictly utility-only
			expect(navSecondarySpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).toEqual([
				"/settings",
				"https://docs.z8-time.app/docs",
				"https://github.com/Umami-Creative-GmbH/z8/issues",
			]);

			// Team section
			if (expectedTeam === null) {
				expect(screen.queryByTestId("nav-team")).toBeNull();
			} else {
				expect(navTeamSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url)).toEqual(
					expectedTeam,
				);
			}

			// Organization section
			if (expectedOrg === null) {
				expect(screen.queryByTestId("nav-organization")).toBeNull();
			} else {
				expect(
					navOrganizationSpy.mock.lastCall?.[0].map((item: { url: string }) => item.url),
				).toEqual(expectedOrg);
			}
		},
	);

	it("exposes account-only settings in app search when settingsAccess is null (former employee or unapproved membership)", () => {
		render(
			<AppSidebar
				employeeRole={null}
				settingsAccess={null}
				settingsCapabilities={{
					canAccessClosedMonths: true,
					canManageApprovalEscalation: true,
					canManageProjects: true,
					canManageDrivingLicence: true,
					hasActiveReportShareLinks: true,
				}}
			/>,
		);

		const lastCall = appSearchSpy.mock.lastCall?.[0] as {
			staticResults: Array<{ type: string; href: string }>;
		};
		const settingHrefs = lastCall.staticResults
			.filter((result) => result.type === "setting")
			.map((result) => result.href);
		expect(settingHrefs).toEqual([
			"/settings/profile",
			"/settings/security",
			"/settings/notifications",
			"/settings/wellness",
		]);
	});

	it("passes custom-role settingsCapabilities and owner compliance access from ServerAppSidebar to AppSidebar and AppSearch", async () => {
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
			user: { id: "user_1", role: "user" },
			session: { activeOrganizationId: "org_1" },
			employee: { id: "emp_1", organizationId: "org_1", role: "employee" },
		});
		getRenderSettingsAccessMock.mockResolvedValueOnce("member");
		getRenderOrganizationAbilityMock.mockResolvedValueOnce({
			can: (action: string, subject: string) =>
				(action === "close" && subject === "PayrollPeriod") ||
				(action === "manage" && subject === "Approval"),
		});
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);
		loadFinanceActorMock.mockResolvedValue(null);

		vi.doUnmock("./app-sidebar");
		vi.resetModules();
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment: canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");
		const { unmount } = render(await ServerAppSidebar({}));

		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({
						type: "page",
						href: "/payroll",
					}),
					expect.objectContaining({
						type: "setting",
						href: "/settings/approval-policies",
					}),
				]),
			}),
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.not.arrayContaining([
					expect.objectContaining({ href: "/settings/organization" }),
				]),
			}),
		);
		unmount();

		// Owner gets compliance nav and owner settingsAccess.
		getRenderSettingsAccessMock.mockResolvedValueOnce("owner");
		getRenderOrganizationAbilityMock.mockResolvedValueOnce(null);
		vi.resetModules();
		vi.doMock("./app-sidebar", () => ({ AppSidebar: SidebarProxy }));
		try {
			const { ServerAppSidebar: ServerAppSidebarProxied } = await import("./server-app-sidebar");
			render(await ServerAppSidebarProxied({}));

			expect(appSidebarSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					settingsAccess: "owner",
					navigationCapabilities: expect.objectContaining({ compliance: true }),
					settingsCapabilities: expect.objectContaining({
						canAccessClosedMonths: true,
					}),
				}),
			);
		} finally {
			vi.doUnmock("./app-sidebar");
		}
	});
});
