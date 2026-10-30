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
	loadFinanceActorMock,
	loadCurrentPersonnelFileAccessMock,
	loadCollectsPeriodSubmissionsMock,
	listWhoIsInLocationsMock,
	readDrivingLicenceVisibilityMock,
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
	loadFinanceActorMock: vi.fn(),
	loadCurrentPersonnelFileAccessMock: vi.fn(),
	loadCollectsPeriodSubmissionsMock: vi.fn(),
	listWhoIsInLocationsMock: vi.fn(),
	readDrivingLicenceVisibilityMock: vi.fn(),
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

vi.mock("@/lib/auth/render-context", () => ({
	getRenderAuthContext: getAuthContextMock,
	getRenderUserOrganizations: getUserOrganizationsMock,
	getRenderSettingsAccessTier: getCurrentSettingsAccessTierMock,
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
}));

vi.mock("@/components/travel-expenses/finance/finance-nav-badge", () => ({
	FinanceNavBadge: () => <span>3</span>,
}));

vi.mock("@/components/nav-main", () => ({
	NavMain: ({
		items,
	}: {
		items: Array<{ title: string; url: string; icon: unknown }>;
	}) => {
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
	NavTeam: ({
		items,
	}: {
		items: Array<{ title: string; url: string; icon: unknown }>;
	}) => {
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
	Sidebar: ({ children, ...props }: { children: ReactNode }) => (
		<div {...props}>{children}</div>
	),
	SidebarContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SidebarHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

import { AppSidebar } from "./app-sidebar";

function SidebarProxy(props: Record<string, unknown>) {
	appSidebarSpy(props);
	return <div data-testid="server-sidebar-proxy" />;
}
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
		loadFinanceActorMock.mockReset();
		loadCurrentPersonnelFileAccessMock.mockReset();
		loadCollectsPeriodSubmissionsMock.mockReset();
		loadCollectsPeriodSubmissionsMock.mockResolvedValue(false);
		listWhoIsInLocationsMock.mockReset();
		listWhoIsInLocationsMock.mockResolvedValue([]);
		readDrivingLicenceVisibilityMock.mockReset();
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

		expect(
			screen.getByRole("link", { name: "My Requests" }).getAttribute("href"),
		).toBe("/my-requests");
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

		expect(
			screen.getByRole("link", { name: "My Documents" }).getAttribute("href"),
		).toBe("/my-documents");
		const urls = navMainSpy.mock.lastCall?.[0].map((item) => item.url) ?? [];
		expect(urls.indexOf("/my-documents")).toBe(
			urls.indexOf("/my-requests") + 1,
		);
	});

	it("renders Personnel Files after My Documents only with the capability (#866)", () => {
		const { unmount } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "Personnel Files" })).toBeNull();
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

		expect(
			screen
				.getByRole("link", { name: "Personnel Files" })
				.getAttribute("href"),
		).toBe("/personnel-files");
		const urls = navMainSpy.mock.lastCall?.[0].map((item) => item.url) ?? [];
		expect(urls.indexOf("/personnel-files")).toBe(
			urls.indexOf("/my-documents") + 1,
		);
	});

	it("renders the personal Driving licence item after Personnel Files only with the capability (#1420)", () => {
		const { unmount } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "Driving licence" })).toBeNull();
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
					personnelFiles: true,
					drivingLicence: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(
			screen
				.getByRole("link", { name: "Driving licence" })
				.getAttribute("href"),
		).toBe("/driving-licence");
		const urls = navMainSpy.mock.lastCall?.[0].map((item) => item.url) ?? [];
		expect(urls.indexOf("/driving-licence")).toBe(
			urls.indexOf("/personnel-files") + 1,
		);
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticResults: expect.arrayContaining([
					expect.objectContaining({
						title: "Driving licence",
						href: "/driving-licence",
					}),
				]),
			}),
		);
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
			canCreateOrganizationsForDeploymentMock.mockImplementation(
				(value: boolean) => value,
			);
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
			getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(null);
			loadCurrentPersonnelFileAccessMock.mockResolvedValue(current);

			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment:
					canCreateOrganizationsForDeploymentMock,
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
				if (!enabled)
					expect(loadCurrentPersonnelFileAccessMock).not.toHaveBeenCalled();
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
			true,
			false,
		],
		[
			"verifier",
			{ featureEnabled: true, verifier: true, settings: "hidden" },
			true,
			false,
		],
		[
			"planner",
			{ featureEnabled: true, planner: true, settings: "hidden" },
			true,
			false,
		],
		[
			"former intended driver",
			{ featureEnabled: true, ownRetainedRecords: true, settings: "full" },
			true,
			true,
		],
		[
			"member without a role",
			{ featureEnabled: true, settings: "full" },
			false,
			true,
		],
		[
			"feature off",
			{ featureEnabled: false, settings: "retention_only" },
			false,
			true,
		],
		[
			"feature off without records",
			{ featureEnabled: false, settings: "hidden" },
			false,
			false,
		],
	])(
		"decides the Driving licence item and settings entry from the visibility reader (%s, #1420)",
		async (_case, view, drivingLicence, drivingLicenceSettingsVisible) => {
			vi.stubEnv("BILLING_ENABLED", "false");
			canCreateOrganizationsForDeploymentMock.mockImplementation(
				(value: boolean) => value,
			);
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
			getCurrentSettingsAccessTierMock.mockResolvedValueOnce("orgAdmin");
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

			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment:
					canCreateOrganizationsForDeploymentMock,
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
						navigationCapabilities: expect.objectContaining({ drivingLicence }),
						drivingLicenceSettingsVisible,
					}),
				);
			} finally {
				vi.doUnmock("./app-sidebar");
			}
		},
	);

	it("renders Org Explorer as a primary personal navigation item", () => {
		render(<AppSidebar />);

		expect(
			screen.getByRole("link", { name: "Org Explorer" }).getAttribute("href"),
		).toBe("/organization");
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
				staticResults: expect.not.arrayContaining([
					expect.objectContaining({ href: "/payroll" }),
				]),
				staticCommands: expect.not.arrayContaining([
					expect.objectContaining({ href: "/payroll" }),
				]),
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
					expect.objectContaining({ href: "/settings/organizations" }),
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
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(
			screen.getByRole("link", { name: "Works Council" }).getAttribute("href"),
		).toBe("/works-council");
		expect(appSearchSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				staticCommands: expect.any(Array),
			}),
		);
		expect(requireAbilityMock).toHaveBeenCalled();
		expect(canViewWorksCouncilPortalMock).toHaveBeenCalledWith(
			{},
			"org_1",
			"org_1",
		);
	});

	it("uses the active organization for works council navigation when no employee exists", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({ showWorksCouncilNav: true }));

		expect(
			screen.getByRole("link", { name: "Works Council" }).getAttribute("href"),
		).toBe("/works-council");
		expect(requireAbilityMock).toHaveBeenCalled();
		expect(canViewWorksCouncilPortalMock).toHaveBeenCalledWith(
			{},
			"org_1",
			"org_1",
		);
	});

	it("hides works council navigation when the organization feature flag is disabled", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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

		rerender(
			<AppSidebar
				employeeRole="employee"
				navigationCapabilities={capabilities}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "My Schedule" }).getAttribute("href"),
		).toBe("/scheduling");
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

		expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url)).not.toContain(
			"/scheduling",
		);
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
			expect(
				navTeamSpy.mock.lastCall?.[0].map((item) => item.url),
			).not.toContain("/team/presence");
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
			rerender(
				<AppSidebar
					employeeRole={role}
					navigationCapabilities={capabilities}
				/>,
			);
			expect(
				navTeamSpy.mock.lastCall?.[0].map((item) => item.url),
			).not.toContain("/team/presence");
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
			getCurrentSettingsAccessTierMock.mockResolvedValue(
				role === "admin"
					? "orgAdmin"
					: role === "manager"
						? "manager"
						: "member",
			);
			listWhoIsInLocationsMock.mockResolvedValue(locations);
			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment:
					canCreateOrganizationsForDeploymentMock,
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
					expect(listWhoIsInLocationsMock).toHaveBeenCalledWith(
						expect.anything(),
						{ organizationId: "org_1" },
					);
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
			canCreateOrganizationsForDeploymentMock.mockImplementation(
				(value: boolean) => value,
			);
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
			getCurrentSettingsAccessTierMock.mockResolvedValueOnce(
				role === "admin"
					? "orgAdmin"
					: role === "manager"
						? "manager"
						: "member",
			);
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(null);
			loadCollectsPeriodSubmissionsMock.mockResolvedValue(collects);

			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment:
					canCreateOrganizationsForDeploymentMock,
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

	it("renders Team Absences after Team for managers only", () => {
		const { rerender } = render(<AppSidebar employeeRole="manager" />);

		expect(navTeamSpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Team Absences",
					url: "/team/absences",
					icon: IconBeach,
				}),
			]),
		);
		expect(
			navTeamSpy.mock.lastCall?.[0].map((item) => item.url).slice(0, 2),
		).toEqual(["/team", "/team/absences"]);

		navTeamSpy.mockClear();
		rerender(<AppSidebar employeeRole="employee" />);

		expect(navTeamSpy).not.toHaveBeenCalled();
	});

	it("renders the Finance item after Travel Expenses, with its count, only when enabled (#753)", () => {
		const { rerender } = render(<AppSidebar employeeRole="employee" />);
		expect(screen.queryByRole("link", { name: "Finance" })).toBeNull();

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
		expect(
			screen.getByRole("link", { name: "Finance" }).getAttribute("href"),
		).toBe("/travel-expenses/finance");
		const items = navMainSpy.mock.lastCall?.[0] ?? [];
		expect(items.map((item: { url: string }) => item.url).slice(4, 6)).toEqual([
			"/travel-expenses",
			"/travel-expenses/finance",
		]);
		expect(items[5]?.badge).toBeTruthy();
	});

	it.each([
		["shows", { canRead: true }, true],
		["hides", { canRead: false }, false],
		["hides", null, false],
	])(
		"%s Finance navigation from the finance actor's read access (#753)",
		async (_verb, actor, finance) => {
			vi.stubEnv("BILLING_ENABLED", "false");
			canCreateOrganizationsForDeploymentMock.mockImplementation(
				(value: boolean) => value,
			);
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
			getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");
			hasActivePayrollAccessGrantMock.mockResolvedValue(false);
			loadFinanceActorMock.mockResolvedValue(actor);

			vi.doMock("@/lib/auth-helpers", () => ({
				getUserOrganizations: getUserOrganizationsMock,
				getAuthContext: getAuthContextMock,
				getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
				requireAbility: requireAbilityMock,
			}));
			vi.doMock("@/lib/organization/creation-policy.server", () => ({
				canCreateOrganizationsForDeployment:
					canCreateOrganizationsForDeploymentMock,
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

		expect(
			screen.getByRole("link", { name: "Get Help" }).getAttribute("href"),
		).toBe("https://docs.z8-time.app/docs");
		expect(
			screen.getByRole("link", { name: "Feedback" }).getAttribute("href"),
		).toBe("https://github.com/Umami-Creative-GmbH/z8/issues");
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

		expect(
			screen.getByRole("link", { name: "Platform Admin" }).getAttribute("href"),
		).toBe("/platform-admin");

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
		const { rerender } = render(
			<AppSidebar
				navigationCapabilities={{
					scheduling: false,
					compliance: true,
					payroll: false,
					worksCouncil: false,
					platformAdmin: false,
				}}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "Compliance" }).getAttribute("href"),
		).toBe("/compliance");
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Compliance",
					url: "/compliance",
					icon: IconShieldCheck,
				}),
			]),
		);

		rerender(<AppSidebar />);

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

		rerender(
			<AppSidebar
				navigationCapabilities={{
					scheduling: false,
					compliance: false,
					payroll: false,
					worksCouncil: true,
					platformAdmin: false,
				}}
			/>,
		);

		expect(
			screen.getByRole("link", { name: "Works Council" }).getAttribute("href"),
		).toBe("/works-council");
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
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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
					payroll: false,
					platformAdmin: false,
					scheduling: true,
				}),
				employeeRole: "admin",
				settingsAccessTier: "orgAdmin",
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
				},
			}),
		);
		expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			payrollEmployeeId: "emp_admin",
		});

		appSidebarSpy.mockReset();
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({
					compliance: false,
					payroll: false,
					platformAdmin: false,
					scheduling: true,
				}),
				settingsAccessTier: "member",
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
				},
			}),
		);
	});

	it("passes scoped payroll navigation for active employees with payroll access grants", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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

	it("hides payroll navigation for admins without an active payroll grant", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
		getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
		hasActivePayrollAccessGrantMock.mockResolvedValue(false);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
		}));
		vi.doMock("./app-sidebar", () => ({
			AppSidebar: SidebarProxy,
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				navigationCapabilities: expect.objectContaining({ payroll: false }),
				employeeRole: "admin",
			}),
		);
		expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			payrollEmployeeId: "employee-admin",
		});
	});

	it("shows payroll navigation for admins with an active payroll grant", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
		getCurrentSettingsAccessTierMock.mockResolvedValue("orgAdmin");
		hasActivePayrollAccessGrantMock.mockResolvedValue(true);

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
			requireAbility: requireAbilityMock,
		}));
		vi.doMock("@/lib/organization/creation-policy.server", () => ({
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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
		expect(hasActivePayrollAccessGrantMock).toHaveBeenCalledWith({
			organizationId: "org_1",
			payrollEmployeeId: "employee-admin",
		});
	});

	it("hides scoped payroll navigation for employees without active grants", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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
		canCreateOrganizationsForDeploymentMock.mockImplementation(
			(value: boolean) => value,
		);
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
			canCreateOrganizationsForDeployment:
				canCreateOrganizationsForDeploymentMock,
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
				settingsAccessTier: "member",
				canCreateOrganizations: true,
			}),
		);
	});
});
