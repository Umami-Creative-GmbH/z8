// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportsContainer } from "@/components/reports/reports-container";

const boundary = vi.hoisted(() => ({
	fetch: vi.fn(),
	read: vi.fn(),
	generate: vi.fn(),
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => boundary.session,
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_: string, fallback: string) => fallback }),
}));
vi.mock("@/app/[locale]/(app)/reports/actions", () => ({
	getAccessibleEmployeesAction: boundary.read,
	generateReport: boundary.generate,
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }),
}));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({
	exportToPDF: vi.fn(),
	generatePDFFilename: () => "synthetic.pdf",
}));
vi.mock("@/components/closed-months/month-closure-strip", () => ({
	MonthClosureStrip: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function contextResponse() {
	return new Response(
		JSON.stringify({
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
			employee: { employeeId: "employee-a", organizationId: "org-a", role: "admin" },
			organizationSettings: {
				organizationId: "org-a",
				timezone: "Europe/Berlin",
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
				worksCouncilEnabled: false,
				billableTimeEnabled: false,
				personnelFilesEnabled: false,
				equipmentEnabled: false,
				deletedAt: null,
			},
		}),
	);
}
const clients: QueryClient[] = [];
beforeEach(() => {
	vi.clearAllMocks();
	boundary.fetch.mockReset();
	boundary.fetch.mockImplementation(async () => contextResponse());
	vi.stubGlobal("fetch", boundary.fetch);
	boundary.read.mockResolvedValue({
		success: true,
		data: [
			{
				id: "employee-a",
				name: "Synthetic Employee",
				firstName: "Synthetic",
				lastName: "Employee",
				email: "employee@example.test",
				role: "admin",
				image: null,
				pronouns: null,
				position: null,
			},
		],
	});
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
	vi.unstubAllGlobals();
});
function mount(
	content = (
		<ReportsContainer currentEmployeeId="employee-a" userId="actor-a" organizationId="org-a" />
	),
) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={null}>{content}</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	return client;
}

it("recovers failed organization settings through local Retry before enabling report generation", async () => {
	boundary.fetch.mockImplementation(
		async () =>
			new Response(JSON.stringify({ error: "Synthetic organization settings unavailable" }), {
				status: 503,
			}),
	);
	const client = mount();
	await waitFor(() =>
		expect(
			client
				.getQueryCache()
				.findAll({
					queryKey: ["organization-context"],
				})
				.some((query) => query.state.status === "error"),
		).toBe(true),
	);
	expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty("disabled", true);
	expect.soft(screen.queryByText("Synthetic organization settings unavailable")).not.toBeNull();
	const retry = screen.getByRole("button", { name: "Retry" });
	boundary.fetch.mockImplementation(async () => contextResponse());
	await act(async () => fireEvent.click(retry));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty(
			"disabled",
			false,
		),
	);
	expect(screen.queryByText("Synthetic organization settings unavailable")).toBeNull();
	expect(boundary.fetch).toHaveBeenCalledTimes(2);
	expect(boundary.generate).not.toHaveBeenCalled();
});

it("keeps failed settings recoverable and prevents duplicate transport while Retry is pending", async () => {
	boundary.fetch.mockImplementation(
		async () =>
			new Response(JSON.stringify({ error: "Synthetic settings outage" }), { status: 503 }),
	);
	mount();
	const retry = await screen.findByRole("button", { name: "Retry" });
	const held = Promise.withResolvers<Response>();
	boundary.fetch.mockReturnValueOnce(held.promise);
	await act(async () => {
		fireEvent.click(retry);
		fireEvent.click(retry);
	});
	expect(boundary.fetch).toHaveBeenCalledTimes(2);
	expect(screen.getByRole("button", { name: "Retrying…" })).toHaveProperty("disabled", true);
	expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty("disabled", true);
	await act(async () =>
		held.resolve(new Response(JSON.stringify({ error: "Still unavailable" }), { status: 503 })),
	);
	await screen.findByText("Still unavailable");
	const nextRetry = await screen.findByRole("button", { name: "Retry" });
	boundary.fetch.mockImplementation(async () => contextResponse());
	await act(async () => fireEvent.click(nextRetry));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty(
			"disabled",
			false,
		),
	);
	expect(boundary.fetch).toHaveBeenCalledTimes(3);
	expect(boundary.generate).not.toHaveBeenCalled();
});

it("retains the selected period across a failed settings refresh without permitting generation until Retry succeeds", async () => {
	const client = mount(
		<ReportFilters currentEmployeeId="employee-a" onGenerate={boundary.generate} />,
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty(
			"disabled",
			false,
		),
	);
	fireEvent.click(screen.getByRole("combobox", { name: "Period" }));
	fireEvent.click(await screen.findByRole("option", { name: "Last Year" }));
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Generate Report" })));
	expect(boundary.generate).toHaveBeenCalledTimes(1);
	const selectedCommand = boundary.generate.mock.calls[0];
	boundary.fetch.mockResolvedValueOnce(
		new Response(JSON.stringify({ error: "Settings refresh refused" }), { status: 503 }),
	);
	await act(async () => client.refetchQueries({ queryKey: ["organization-context"] }));
	await screen.findByText("Settings refresh refused");
	const generate = screen.getByRole("button", { name: "Generate Report" });
	expect.soft(generate).toHaveProperty("disabled", true);
	expect
		.soft(screen.queryByText("Loading organization settings before enabling presets."))
		.toBeNull();
	const form = generate.closest("form");
	if (!form) throw new Error("Expected report generation form");
	const submit = new Event("submit", { bubbles: true, cancelable: true });
	await act(async () => fireEvent(form, submit));
	expect(submit.defaultPrevented).toBe(true);
	expect(boundary.generate).toHaveBeenCalledTimes(1);
	await act(async () =>
		fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" })),
	);
	await waitFor(() => expect(generate).toHaveProperty("disabled", false));
	expect(screen.getByRole("combobox", { name: "Period" }).textContent).toContain("Last Year");
	await act(async () => fireEvent.click(generate));
	expect(boundary.generate).toHaveBeenCalledTimes(2);
	expect(boundary.generate.mock.calls[1]).toEqual(selectedCommand);
});
