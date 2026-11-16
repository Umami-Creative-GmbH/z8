// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportsContainer } from "@/components/reports/reports-container";
import type { AccessibleEmployee } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	listeners: new Set<
		(value: {
			data: { user: { id: string }; session: { activeOrganizationId: string } };
		}) => void
	>(),
	session: {
		data: {
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
		},
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => mocks.session,
	authClient: {
		$store: {
			atoms: {
				session: {
					subscribe: (fn: (value: typeof mocks.session) => void) => {
						mocks.listeners.add(fn);
						return () => mocks.listeners.delete(fn);
					},
				},
			},
		},
	},
}));
vi.mock("@/app/[locale]/(app)/reports/actions", () => ({
	getAccessibleEmployeesAction: mocks.read,
	generateReport: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_: string, fallback: string) => fallback }),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en",
}));
vi.mock("@/components/closed-months/month-closure-strip", () => ({
	MonthClosureStrip: () => null,
}));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({
	exportToPDF: vi.fn(),
	generatePDFFilename: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
	vi.resetAllMocks();
	mocks.session = {
		data: {
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
		},
		isPending: false,
	};
	useOrganizationSettings.setState({
		isHydrated: true,
		timezone: "Europe/Berlin",
	});
});

function employee(id: string, name: string): AccessibleEmployee {
	return {
		id,
		name,
		firstName: name,
		lastName: null,
		email: `${id}@example.test`,
		image: null,
		pronouns: null,
		position: null,
		role: "employee",
	};
}

it("does not reuse retired actor/organization options on A → B → A while the current roster read is held", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	useOrganizationSettings.setState({
		isHydrated: true,
		timezone: "Europe/Berlin",
	});
	mocks.read.mockResolvedValueOnce({
		success: true,
		data: [
			employee("employee-a", "Cached actor A"),
			employee("former-a", "Former confidential A"),
		],
	});
	function view(employeeId: string, actor: string, org: string) {
		return (
			<QueryClientProvider client={client}>
				<ReportsContainer
					currentEmployeeId={employeeId}
					userId={actor}
					organizationId={org}
				/>
			</QueryClientProvider>
		);
	}
	const mounted = render(view("employee-a", "actor-a", "org-a"));
	await screen.findByText("Cached actor A");
	// The new authority reads are deliberately held, without changing server results.
	mocks.read.mockImplementation(() => new Promise(() => {}));
	await act(async () => {
		mocks.session = {
			...mocks.session,
			data: {
				user: { id: "actor-b" },
				session: { activeOrganizationId: "org-b" },
			},
		};
		for (const fn of mocks.listeners) fn({ data: mocks.session.data });
		mounted.rerender(view("employee-b", "actor-b", "org-b"));
	});
	await act(async () => {
		mocks.session = {
			...mocks.session,
			data: {
				user: { id: "actor-a" },
				session: { activeOrganizationId: "org-a" },
			},
		};
		for (const fn of mocks.listeners) fn({ data: mocks.session.data });
		mounted.rerender(view("employee-a", "actor-a", "org-a"));
	});
	expect(screen.queryByText("Cached actor A")).toBeNull();
	expect(screen.queryByText("Former confidential A")).toBeNull();
	expect(mocks.read).toHaveBeenCalledTimes(3);
	client.clear();
});

it.each(["success", "refusal", "rejection"])(
	"retires a deferred roster %s on Activity return under StrictMode without clearing peer caches",
	async (outcome) => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		client.setQueryData(["reports", "peer"], "retained peer");
		let resolve!: (value: unknown) => void;
		let reject!: (reason: Error) => void;
		mocks.read.mockImplementation(
			() =>
				new Promise((done, fail) => {
					resolve = done;
					reject = fail;
				}),
		);
		const view = (mode: "hidden" | "visible") => (
			<QueryClientProvider client={client}>
				<StrictMode>
					<Activity mode={mode}>
						<ReportsContainer
							currentEmployeeId="employee-a"
							userId="actor-a"
							organizationId="org-a"
						/>
					</Activity>
				</StrictMode>
			</QueryClientProvider>
		);
		const mounted = render(view("visible"));
		await waitFor(() => expect(mocks.read).toHaveBeenCalled());
		const oldResolve = resolve,
			oldReject = reject;
		await act(async () => mounted.rerender(view("hidden")));
		await act(async () => mounted.rerender(view("visible")));
		await waitFor(() => expect(resolve).not.toBe(oldResolve));
		await act(async () => {
			if (outcome === "rejection")
				oldReject(new Error("Retired network failure"));
			else
				oldResolve(
					outcome === "success"
						? {
								success: true,
								data: [
									employee("employee-a", "Retired roster"),
									employee("former", "Retired former"),
								],
							}
						: { success: false, error: "Retired refusal" },
				);
		});
		expect(screen.queryByText("Retired roster")).toBeNull();
		expect(screen.queryByText("Retired refusal")).toBeNull();
		await act(async () =>
			resolve({
				success: true,
				data: [
					employee("employee-a", "Current actor A"),
					employee("other", "Current colleague"),
				],
			}),
		);
		await screen.findByText("Current actor A");
		expect(client.getQueryData(["reports", "peer"])).toBe("retained peer");
		mounted.unmount();
		await waitFor(() =>
			expect(
				client
					.getQueryCache()
					.findAll({ queryKey: ["reports", "employees", "employee-a"] }),
			).toHaveLength(0),
		);
		client.clear();
	},
);

it("retains current roster during same-arrival refetch and rerenders, but hides it while session is disabled", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	mocks.read.mockResolvedValueOnce({
		success: true,
		data: [
			employee("employee-a", "Current actor A"),
			employee("other", "Current colleague"),
		],
	});
	const view = () => (
		<QueryClientProvider client={client}>
			<ReportsContainer
				currentEmployeeId="employee-a"
				userId="actor-a"
				organizationId="org-a"
			/>
		</QueryClientProvider>
	);
	const mounted = render(view());
	await screen.findByText("Current actor A");
	mounted.rerender(view());
	expect(mocks.read).toHaveBeenCalledTimes(1);
	let resolve!: (value: unknown) => void;
	mocks.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	let refresh!: Promise<void>;
	await act(async () => {
		refresh = client.invalidateQueries({ queryKey: ["reports"] });
	});
	expect(screen.getByText("Current actor A")).toBeTruthy();
	await act(async () =>
		resolve({
			success: true,
			data: [
				employee("employee-a", "Refreshed actor A"),
				employee("other", "Current colleague"),
			],
		}),
	);
	await refresh;
	await screen.findByText("Refreshed actor A");
	mocks.session = { ...mocks.session, isPending: true };
	mounted.rerender(view());
	expect(screen.queryByText("Refreshed actor A")).toBeNull();
	await waitFor(() =>
		expect(
			client
				.getQueryCache()
				.findAll({ queryKey: ["reports", "employees", "employee-a"] }),
		).toHaveLength(0),
	);
	client.clear();
});
