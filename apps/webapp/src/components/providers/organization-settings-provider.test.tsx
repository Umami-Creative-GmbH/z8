/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAbility } from "@/hooks/use-ability";
import { useOrganization } from "@/hooks/use-organization";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { OrganizationSettingsProvider } from "./organization-settings-provider";

const mocks = vi.hoisted(() => ({
	session: { data: null as unknown, isPending: false },
	replace: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => mocks.session,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: mocks.replace }),
}));

const observedSettings: string[] = [];

function SettingsProbe() {
	const settings = useOrganizationSettings();
	observedSettings.push(
		`${settings.organizationId ?? ""}:${settings.timezone}:${String(settings.isHydrated)}`,
	);
	return (
		<div data-testid="settings">
			{settings.organizationId}:{settings.timezone}:
			{String(settings.isHydrated)}
		</div>
	);
}

const bootstrap = {
	userId: "user-1",
	organizationId: "org-1",
	employee: {
		employeeId: "employee-1",
		organizationId: "org-1",
		role: "admin" as const,
	},
	organizationSettings: {
		organizationId: "org-1",
		shiftsEnabled: true,
		projectsEnabled: true,
		surchargesEnabled: false,
		demoDataEnabled: false,
		worksCouncilEnabled: true,
		billableTimeEnabled: false,
		personnelFilesEnabled: false,
		timezone: "Europe/Berlin",
		deletedAt: null,
	},
	updatedAt: 1_792_800_000_000,
};

function ContextProbe({ name }: { name: string }) {
	const context = useOrganization();
	return (
		<div data-testid={name}>
			{context.organizationId}:{context.employeeId}:{context.role}:
			{String(context.isLoading)}
		</div>
	);
}

function AbilityProbe() {
	const ability = useAbility();
	return (
		<div data-testid="ability">
			{String(ability.can("manage", "Team"))}:{String(ability.isLoading)}
		</div>
	);
}

function ContextErrorProbe() {
	return <div data-testid="context-error">{useOrganization().error}</div>;
}

function RefreshContext() {
	const { refetch } = useOrganization();
	return (
		<button
			type="button"
			onClick={() => {
				void refetch();
			}}
		>
			Refresh context
		</button>
	);
}

describe("OrganizationSettingsProvider", () => {
	beforeEach(() => {
		mocks.session = {
			data: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			isPending: false,
		};
		mocks.fetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: bootstrap.employee,
					organizationSettings: bootstrap.organizationSettings,
				}),
			),
		);
		vi.stubGlobal("fetch", mocks.fetch);
	});
	afterEach(() => {
		cleanup();
		act(() => useOrganizationSettings.getState().reset());
		vi.clearAllMocks();
		observedSettings.length = 0;
		vi.unstubAllGlobals();
	});

	it("hydrates server-provided settings without fetching auth context", async () => {
		render(
			<OrganizationSettingsProvider
				initialSettings={{
					organizationId: "org-1",
					shiftsEnabled: true,
					projectsEnabled: true,
					surchargesEnabled: false,
					demoDataEnabled: false,
					worksCouncilEnabled: true,
					timezone: "Europe/Berlin",
					deletedAt: null,
				}}
			>
				<SettingsProbe />
			</OrganizationSettingsProvider>,
		);

		expect(screen.getByTestId("settings").textContent).toBe(
			"org-1:Europe/Berlin:true",
		);
		expect(observedSettings[0]).toBe("org-1:Europe/Berlin:true");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("shares the server display bootstrap across organization and ability consumers without a context request", () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider
					initialContext={{ ...bootstrap, updatedAt: Date.now() }}
				>
					<ContextProbe name="header" />
					<ContextProbe name="dashboard" />
					<AbilityProbe />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>,
		);
		expect(screen.getByTestId("header").textContent).toBe(
			"org-1:employee-1:admin:false",
		);
		expect(screen.getByTestId("dashboard").textContent).toBe(
			"org-1:employee-1:admin:false",
		);
		expect(screen.getByTestId("ability").textContent).toBe("true:false");
		expect(screen.getByTestId("settings").textContent).toBe(
			"org-1:Europe/Berlin:true",
		);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("shares one pending context request when the server bootstrap is unavailable", async () => {
		let complete!: (response: Response) => void;
		mocks.fetch.mockReturnValue(
			new Promise<Response>((resolve) => {
				complete = resolve;
			}),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={null}>
					<ContextProbe name="header" />
					<ContextProbe name="dashboard" />
					<AbilityProbe />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>,
		);
		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
		expect(mocks.fetch).toHaveBeenCalledWith(
			"/api/auth/context",
			expect.objectContaining({
				cache: "no-store",
				headers: {
					"x-z8-context-user": "user-1",
					"x-z8-context-organization": "org-1",
				},
			}),
		);
		expect(screen.getByTestId("header").textContent).toBe(":::true");
		await act(async () =>
			complete(
				new Response(
					JSON.stringify({
						user: { id: "user-1" },
						session: { activeOrganizationId: "org-1" },
						employee: bootstrap.employee,
						organizationSettings: bootstrap.organizationSettings,
					}),
				),
			),
		);
		await waitFor(() =>
			expect(screen.getByTestId("dashboard").textContent).toBe(
				"org-1:employee-1:admin:false",
			),
		);
		expect(screen.getByTestId("settings").textContent).toBe(
			"org-1:Europe/Berlin:true",
		);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it("replaces a previous broader display role when the same identity receives a newer server bootstrap", () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const initial = { ...bootstrap, updatedAt: Date.now() };
		const view = (context: OrganizationDisplayContext) => (
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={context}>
					<ContextProbe name="header" />
					<AbilityProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>
		);
		const rendered = render(view(initial));
		expect(screen.getByTestId("ability").textContent).toBe("true:false");
		rendered.rerender(
			view({
				...initial,
				employee: { ...initial.employee, role: "employee" },
				updatedAt: initial.updatedAt + 1,
			}),
		);
		expect(screen.getByTestId("header").textContent).toBe(
			"org-1:employee-1:employee:false",
		);
		expect(screen.getByTestId("ability").textContent).toBe("false:false");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("rejects a fallback response for a different user and organization", async () => {
		mocks.fetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					user: { id: "user-2" },
					session: { activeOrganizationId: "org-2" },
					employee: {
						employeeId: "employee-2",
						organizationId: "org-2",
						role: "admin",
					},
					organizationSettings: {
						...bootstrap.organizationSettings,
						organizationId: "org-2",
					},
				}),
			),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={null}>
					<ContextProbe name="header" />
					<ContextErrorProbe />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("context-error").textContent).toContain(
				"Organization context changed",
			),
		);
		expect(screen.getByTestId("header").textContent).toBe(":::false");
		expect(screen.getByTestId("settings").textContent).toBe(":UTC:false");
	});

	it("shares a fallback read and hydrates settings for consumers without a bootstrap provider", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<ContextProbe name="header" />
				<ContextProbe name="dashboard" />
				<AbilityProbe />
				<SettingsProbe />
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("header").textContent).toBe(
				"org-1:employee-1:admin:false",
			),
		);
		expect(screen.getByTestId("settings").textContent).toBe(
			"org-1:Europe/Berlin:true",
		);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it("shows known server display data while the client session is pending, then clears it on sign-out", () => {
		mocks.session = { data: null, isPending: true };
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const context = { ...bootstrap, updatedAt: Date.now() };
		const view = (
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={context}>
					<ContextProbe name="header" />
					<AbilityProbe />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>
		);
		const rendered = render(view);
		expect(screen.getByTestId("header").textContent).toBe(
			"org-1:employee-1:admin:false",
		);
		mocks.session = { data: null, isPending: false };
		rendered.rerender(
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={context}>
					<ContextProbe name="header" />
					<AbilityProbe />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>,
		);
		expect(screen.getByTestId("header").textContent).toBe(":::false");
		expect(screen.getByTestId("ability").textContent).toBe("false:false");
		expect(screen.getByTestId("settings").textContent).toBe(":UTC:false");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it.each([
		["user-2", "org-1"],
		["user-1", "org-2"],
	])(
		"replaces display data immediately for identity %s and organization %s",
		(userId, organizationId) => {
			const client = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const view = (context: OrganizationDisplayContext) => (
				<QueryClientProvider client={client}>
					<OrganizationSettingsProvider initialContext={context}>
						<ContextProbe name="header" />
						<AbilityProbe />
						<SettingsProbe />
					</OrganizationSettingsProvider>
				</QueryClientProvider>
			);
			const rendered = render(view({ ...bootstrap, updatedAt: Date.now() }));
			mocks.session = {
				data: {
					user: { id: userId },
					session: { activeOrganizationId: organizationId },
				},
				isPending: false,
			};
			rendered.rerender(
				view({
					...bootstrap,
					userId,
					organizationId,
					employee: {
						employeeId: "employee-2",
						organizationId,
						role: "employee",
					},
					organizationSettings: {
						...bootstrap.organizationSettings,
						organizationId,
						timezone: "America/New_York",
					},
					updatedAt: Date.now() + 1,
				}),
			);
			expect(screen.getByTestId("header").textContent).toBe(
				`${organizationId}:employee-2:employee:false`,
			);
			expect(screen.getByTestId("ability").textContent).toBe("false:false");
			expect(screen.getByTestId("settings").textContent).toBe(
				`${organizationId}:America/New_York:true`,
			);
			expect(mocks.fetch).not.toHaveBeenCalled();
		},
	);

	it("keeps a delayed old-scope response from replacing the new identity's bootstrap", async () => {
		let complete!: (response: Response) => void;
		mocks.fetch.mockReturnValue(
			new Promise<Response>((resolve) => {
				complete = resolve;
			}),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const view = (context: OrganizationDisplayContext | null) => (
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider initialContext={context}>
					<ContextProbe name="header" />
					<SettingsProbe />
				</OrganizationSettingsProvider>
			</QueryClientProvider>
		);
		const rendered = render(view(null));
		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
		mocks.session = {
			data: {
				user: { id: "user-2" },
				session: { activeOrganizationId: "org-2" },
			},
			isPending: false,
		};
		rendered.rerender(
			view({
				...bootstrap,
				userId: "user-2",
				organizationId: "org-2",
				employee: {
					employeeId: "employee-2",
					organizationId: "org-2",
					role: "employee",
				},
				organizationSettings: {
					...bootstrap.organizationSettings,
					organizationId: "org-2",
					timezone: "America/New_York",
				},
				updatedAt: Date.now(),
			}),
		);
		await act(async () =>
			complete(
				new Response(
					JSON.stringify({
						user: { id: "user-1" },
						session: { activeOrganizationId: "org-1" },
						employee: bootstrap.employee,
						organizationSettings: bootstrap.organizationSettings,
					}),
				),
			),
		);
		expect(screen.getByTestId("header").textContent).toBe(
			"org-2:employee-2:employee:false",
		);
		expect(screen.getByTestId("settings").textContent).toBe(
			"org-2:America/New_York:true",
		);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});

	it("clears display roles and settings when an explicit refresh discovers expiry", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<OrganizationSettingsProvider
					initialContext={{ ...bootstrap, updatedAt: Date.now() }}
				>
					<ContextProbe name="header" />
					<ContextErrorProbe />
					<SettingsProbe />
					<RefreshContext />
				</OrganizationSettingsProvider>
			</QueryClientProvider>,
		);
		mocks.fetch.mockResolvedValue(
			new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Refresh context" }));
		await waitFor(() =>
			expect(screen.getByTestId("context-error").textContent).toBe(
				"Unauthorized",
			),
		);
		expect(screen.getByTestId("header").textContent).toBe(":::false");
		expect(screen.getByTestId("settings").textContent).toBe(":UTC:false");
		expect(mocks.replace).toHaveBeenCalledWith("/sign-in");
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
	});
});
