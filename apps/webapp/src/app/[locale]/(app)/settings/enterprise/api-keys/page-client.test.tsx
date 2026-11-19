// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { render } from "@/test/render-with-translations";
import { createApiKey } from "./actions";
import { DeveloperAccessClient, type DeveloperAccessProps } from "./page-client";
import { readApiKeysForView, readWebhooksForView } from "./view-actions";

const transport = vi.hoisted(() => ({
	user: "example-admin",
	org: "example-org",
	pending: false,
	tab: "webhooks",
	refresh: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: transport.user }, session: { activeOrganizationId: transport.org } },
		isPending: transport.pending,
	}),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: transport.refresh, replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams({ tab: transport.tab }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: transport.refresh, replace: vi.fn() }),
}));
vi.mock("./view-actions", () => ({ readApiKeysForView: vi.fn(), readWebhooksForView: vi.fn() }));
vi.mock("./actions", () => ({
	createApiKey: vi.fn(),
	deleteApiKey: vi.fn(),
	updateApiKey: vi.fn(),
}));
const props: DeveloperAccessProps = {
	organizationId: "example-org",
	currentUserId: "example-admin",
	settingsAccess: "orgAdmin",
	initialApiKeys: [],
	initialKeysError: false,
	initialWebhooks: [],
	initialWebhooksError: true,
};
beforeEach(() => {
	vi.clearAllMocks();
	transport.user = "example-admin";
	transport.org = "example-org";
	transport.pending = false;
	transport.tab = "webhooks";
	vi.mocked(readApiKeysForView).mockResolvedValue({ success: true, data: [] });
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: false, error: "Unavailable" });
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						user: { id: transport.user },
						session: { activeOrganizationId: transport.org },
						employee: null,
						organizationSettings: null,
					}),
					{ headers: { "content-type": "application/json" } },
				),
		),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	const tree = () => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider
				initialContext={{
					userId: "example-admin",
					organizationId: "example-org",
					employee: null,
					organizationSettings: null,
					updatedAt: Date.now(),
				}}
			>
				<ViewRefreshProvider>
					<HeaderRefreshButton />
					<DeveloperAccessClient {...props} />
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(tree());
	return { client, view, tree };
}

it("admits the canonical org admin without an employee and recovers the webhook source independently", async () => {
	mount();
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.queryByText("No webhooks configured")).toBeNull();
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("heading", { name: "No webhooks configured" })).toBeTruthy();
	expect(readWebhooksForView).toHaveBeenCalledWith({
		userId: "example-admin",
		organizationId: "example-org",
	});
});

it("recovers failed organization context with the actual local Retry after header refresh", async () => {
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	mount();
	await screen.findByRole("heading", { name: "No webhooks configured" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Unavailable", { status: 503 })),
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Organization context unavailable");
	expect(screen.queryByRole("button", { name: "Add Webhook" })).toBeNull();
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						user: { id: "example-admin" },
						session: { activeOrganizationId: "example-org" },
						employee: null,
						organizationSettings: null,
					}),
					{ headers: { "content-type": "application/json" } },
				),
		),
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("heading", { name: "No webhooks configured" })).toBeTruthy();
});

it("removes old organization controls during actor and organization ABA", async () => {
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	const { view, tree } = mount();
	await screen.findByRole("heading", { name: "No webhooks configured" });
	transport.user = "replacement-actor";
	transport.org = "replacement-org";
	await act(async () => view.rerender(tree()));
	expect(screen.queryByRole("heading", { name: "No webhooks configured" })).toBeNull();
	transport.user = "example-admin";
	transport.org = "example-org";
	await act(async () => view.rerender(tree()));
	expect(await screen.findByRole("heading", { name: "No webhooks configured" })).toBeTruthy();
});

it("keeps drafts across a retained pending session and retires a revealed key at its actual page owner", async () => {
	transport.tab = "keys";
	vi.mocked(createApiKey).mockResolvedValue({
		success: true,
		data: {
			id: "public-fixture-key",
			name: "Payroll fixture",
			prefix: "public-prefix",
			key: "public-test-dummy-key",
			expiresAt: null,
		},
	});
	const { view, tree } = mount();
	const user = userEvent.setup();
	await user.click(screen.getAllByRole("button", { name: "Create Key" })[0]);
	await user.type(await screen.findByRole("textbox", { name: /Name/ }), "Payroll fixture");
	transport.pending = true;
	await act(async () => view.rerender(tree()));
	transport.pending = false;
	await act(async () => view.rerender(tree()));
	expect(await screen.findByRole("textbox", { name: /Name/ })).toHaveProperty(
		"value",
		"Payroll fixture",
	);
	fireEvent.submit(screen.getByRole("button", { name: "Create Key" }).closest("form")!);
	expect(await screen.findByDisplayValue("public-test-dummy-key")).toBeTruthy();
	transport.pending = true;
	await act(async () => view.rerender(tree()));
	transport.pending = false;
	await act(async () => view.rerender(tree()));
	expect(screen.queryByDisplayValue("public-test-dummy-key")).toBeNull();
});

it("retains the actual webhook form draft during a retained pending session", async () => {
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	const { view, tree } = mount();
	await screen.findByRole("heading", { name: "No webhooks configured" });
	const user = userEvent.setup();
	await user.click(screen.getAllByRole("button", { name: "Add Webhook" })[0]);
	await user.type(await screen.findByRole("textbox", { name: "Name" }), "Webhook draft");
	transport.pending = true;
	await act(async () => view.rerender(tree()));
	transport.pending = false;
	await act(async () => view.rerender(tree()));
	expect(await screen.findByRole("textbox", { name: "Name" })).toHaveProperty(
		"value",
		"Webhook draft",
	);
});
