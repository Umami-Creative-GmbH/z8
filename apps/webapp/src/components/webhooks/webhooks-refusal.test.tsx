// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeveloperAccessClient } from "@/app/[locale]/(app)/settings/enterprise/api-keys/page-client";
import {
	readApiKeysForView,
	readWebhooksForView,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions";
import { createWebhook } from "@/app/[locale]/(app)/settings/webhooks/actions";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { render } from "@/test/render-with-translations";

const transport = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "synthetic-admin" }, session: { activeOrganizationId: "synthetic-org" } },
		isPending: false,
	}),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: transport.refresh, replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams({ tab: "webhooks" }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: transport.refresh, replace: vi.fn() }),
}));
vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions", () => ({
	readApiKeysForView: vi.fn(),
	readWebhooksForView: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/actions", () => ({
	createApiKey: vi.fn(),
	updateApiKey: vi.fn(),
	deleteApiKey: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/webhooks/actions", () => ({
	createWebhook: vi.fn(),
	updateWebhook: vi.fn(),
	deleteWebhook: vi.fn(),
	regenerateSecret: vi.fn(),
	testWebhook: vi.fn(),
	getWebhookDeliveryLogs: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: transport.success, error: transport.error } }));

let contextTime = 0;
const clients: QueryClient[] = [];
const views = new Map<QueryClient, ReturnType<typeof render>>();
const endpoint = {
	id: "synthetic-endpoint",
	organizationId: "synthetic-org",
	name: "Synthetic endpoint",
	url: "https://example.invalid/review",
	description: null,
	subscribedEvents: ["absence_request_approved"],
	isActive: true,
	totalDeliveries: 0,
	totalSuccesses: 0,
	consecutiveFailures: 0,
	lastDeliveredAt: null,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
};
const success = {
	success: true as const,
	data: {
		endpoint,
		secret: "SYNTHETIC_INVALID_SIGNING_VALUE_NOT_A_CREDENTIAL",
	},
};

beforeEach(() => {
	vi.resetAllMocks();
	contextTime = Date.now();
	vi.mocked(readApiKeysForView).mockResolvedValue({ success: true, data: [] });
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						user: { id: "synthetic-admin" },
						session: { activeOrganizationId: "synthetic-org" },
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
	for (const client of clients.splice(0)) client.clear();
	views.clear();
	vi.unstubAllGlobals();
});

function Workspace({ client, visible = true }: { client: QueryClient; visible?: boolean }) {
	return (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider
				initialContext={{
					userId: "synthetic-admin",
					organizationId: "synthetic-org",
					employee: null,
					organizationSettings: null,
					updatedAt: contextTime,
				}}
			>
				<ViewRefreshProvider>
					<HeaderRefreshButton />
					<Activity mode={visible ? "visible" : "hidden"}>
						<DeveloperAccessClient
							organizationId="synthetic-org"
							currentUserId="synthetic-admin"
							settingsAccess="owner"
							initialApiKeys={[]}
							initialKeysError={false}
							initialWebhooks={[]}
							initialWebhooksError={false}
						/>
					</Activity>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
}
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	clients.push(client);
	views.set(client, render(<Workspace client={client} />));
	return client;
}
async function showWorkspace(client: QueryClient, visible: boolean) {
	await act(async () => {
		views.get(client)!.rerender(<Workspace client={client} visible={visible} />);
	});
}
async function submitCreate() {
	const user = userEvent.setup();
	await user.click(screen.getAllByRole("button", { name: "Add Webhook" })[0]);
	await user.type(await screen.findByRole("textbox", { name: "Name" }), endpoint.name);
	await user.type(screen.getByRole("textbox", { name: "Endpoint URL" }), endpoint.url);
	await user.click(screen.getByRole("checkbox", { name: "absence_request_approved" }));
	fireEvent.submit(
		screen.getByRole("button", { name: "Create Webhook", exact: true }).closest("form")!,
	);
	await waitFor(() => expect(createWebhook).toHaveBeenCalledTimes(1));
}
async function refuseRead(client: QueryClient) {
	vi.mocked(readWebhooksForView).mockResolvedValue({
		success: false,
		error: "Synthetic refusal",
		code: "AuthorizationError",
	});
	await act(async () => {
		await client.invalidateQueries({
			queryKey: ["developerWebhooks", "synthetic-org", "synthetic-admin"],
		});
	});
	await waitRefused(client);
}
async function waitRefused(client: QueryClient) {
	await waitFor(() =>
		expect(
			client.getQueryData(["developerWebhooks", "synthetic-org", "synthetic-admin"]),
		).toMatchObject({ success: false, code: "AuthorizationError" }),
	);
	await waitFor(() =>
		expect(Boolean(screen.queryByRole("dialog", { name: "Create Webhook" }))).toBe(false),
	);
}

it("control: current successful command reaches the real signing-secret panel", async () => {
	vi.mocked(createWebhook).mockResolvedValue(success as Awaited<ReturnType<typeof createWebhook>>);
	mount();
	await submitCreate();
	await waitFor(() =>
		expect(Boolean(screen.queryByRole("dialog", { name: "Webhook Secret" }))).toBe(true),
	);
});

it("control: an authoritative refusal remains refused without a pending completion", async () => {
	const client = mount();
	await refuseRead(client);
	expect(Boolean(screen.queryByRole("dialog", { name: "Webhook Secret" }))).toBe(false);
	expect(
		Boolean(screen.queryByRole("button", { name: "Add Webhook" })?.hasAttribute("disabled")),
	).toBe(true);
});

it("critical: a dispatched create must not revive a refused list or signing secret", async () => {
	let finish!: (value: Awaited<ReturnType<typeof createWebhook>>) => void;
	vi.mocked(createWebhook).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const client = mount();
	let finishRead!: (value: Awaited<ReturnType<typeof readWebhooksForView>>) => void;
	vi.mocked(readWebhooksForView).mockImplementation(
		() =>
			new Promise((resolve) => {
				finishRead = resolve;
			}),
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Refresh data" }));
	await waitFor(() => expect(readWebhooksForView).toHaveBeenCalledTimes(1));
	await submitCreate();
	await act(async () => {
		finishRead({ success: false, error: "Synthetic refusal", code: "AuthorizationError" });
	});
	await waitRefused(client);
	await act(async () => {
		finish(success as Awaited<ReturnType<typeof createWebhook>>);
	});
	const data = client.getQueryData<{ success: boolean }>([
		"developerWebhooks",
		"synthetic-org",
		"synthetic-admin",
	]);
	const observed = {
		refusedCacheReplacedBySuccess: data?.success === true,
		secretPanelVisible: Boolean(screen.queryByRole("dialog", { name: "Webhook Secret" })),
		newEndpointVisible: Boolean(screen.queryByText(endpoint.name)),
		createCalls: vi.mocked(createWebhook).mock.calls.length,
	};
	expect(observed).toEqual({
		refusedCacheReplacedBySuccess: false,
		secretPanelVisible: false,
		newEndpointVisible: false,
		createCalls: 1,
	});
});

function holdCreate() {
	let resolve!: (value: Awaited<ReturnType<typeof createWebhook>>) => void;
	let reject!: (reason: Error) => void;
	vi.mocked(createWebhook).mockImplementation(
		() =>
			new Promise((yes, no) => {
				resolve = yes;
				reject = no;
			}),
	);
	return {
		resolve: (value: Awaited<ReturnType<typeof createWebhook>>) => resolve(value),
		reject: (reason: Error) => reject(reason),
	};
}

it("keeps the draft and unresolved command lock when a refused read recovers before the old success", async () => {
	const pending = holdCreate();
	const client = mount();
	await submitCreate();
	await refuseRead(client);
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry", exact: true }));
	await screen.findByRole("textbox", { name: "Name" });
	expect(screen.getByDisplayValue(endpoint.name)).toBeTruthy();
	expect(screen.getByDisplayValue(endpoint.url)).toBeTruthy();
	const submit = screen.getByRole("button", { name: "Create Webhook", exact: true });
	expect(submit.hasAttribute("disabled")).toBe(true);
	fireEvent.submit(submit.closest("form")!);
	expect(createWebhook).toHaveBeenCalledTimes(1);
	const refreshCount = transport.refresh.mock.calls.length;
	await act(async () => pending.resolve(success as Awaited<ReturnType<typeof createWebhook>>));
	expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	expect(screen.getByDisplayValue(endpoint.name)).toBeTruthy();
	expect(client.getQueryData(["developerWebhooks", "synthetic-org", "synthetic-admin"])).toEqual({
		success: true,
		data: [],
	});
	expect(transport.refresh).toHaveBeenCalledTimes(refreshCount);
	expect(transport.success).not.toHaveBeenCalled();
	expect(transport.error).not.toHaveBeenCalled();
	vi.mocked(createWebhook).mockResolvedValue(success as Awaited<ReturnType<typeof createWebhook>>);
	fireEvent.submit(submit.closest("form")!);
	await waitFor(() => expect(screen.getByRole("dialog", { name: "Webhook Secret" })).toBeTruthy());
	expect(createWebhook).toHaveBeenCalledTimes(2);
});

it("clears an already revealed signing value on read refusal and does not restore it after Retry", async () => {
	vi.mocked(createWebhook).mockResolvedValue(success as Awaited<ReturnType<typeof createWebhook>>);
	const client = mount();
	await submitCreate();
	await screen.findByRole("dialog", { name: "Webhook Secret" });
	await refuseRead(client);
	await waitFor(() => expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull());
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry", exact: true }));
	await waitFor(() =>
		expect(client.getQueryData(["developerWebhooks", "synthetic-org", "synthetic-admin"])).toEqual({
			success: true,
			data: [],
		}),
	);
	expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	expect(createWebhook).toHaveBeenCalledTimes(1);
});

it.each(["refusal", "rejection"] as const)(
	"suppresses late command %s feedback after an authoritative read refusal",
	async (settlement) => {
		const pending = holdCreate();
		const client = mount();
		await submitCreate();
		await refuseRead(client);
		const refreshCount = transport.refresh.mock.calls.length;
		await act(async () => {
			if (settlement === "refusal")
				pending.resolve({ success: false, error: "Synthetic command refusal" });
			else pending.reject(new Error("Synthetic command transport failure"));
		});
		expect(
			client.getQueryData(["developerWebhooks", "synthetic-org", "synthetic-admin"]),
		).toMatchObject({ success: false });
		expect(transport.error).not.toHaveBeenCalled();
		expect(transport.success).not.toHaveBeenCalled();
		expect(transport.refresh).toHaveBeenCalledTimes(refreshCount);
		expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	},
);

it("allows a current command success during a transient read transport error", async () => {
	const pending = holdCreate();
	const client = mount();
	await submitCreate();
	vi.mocked(readWebhooksForView).mockRejectedValue(new Error("Synthetic read transport failure"));
	await act(async () => {
		await client.invalidateQueries({
			queryKey: ["developerWebhooks", "synthetic-org", "synthetic-admin"],
		});
	});
	await screen.findByText("Webhooks unavailable");
	await act(async () => pending.resolve(success as Awaited<ReturnType<typeof createWebhook>>));
	expect(await screen.findByRole("dialog", { name: "Webhook Secret" })).toBeTruthy();
	expect(
		client.getQueryData(["developerWebhooks", "synthetic-org", "synthetic-admin"]),
	).toMatchObject({ success: true, data: [{ id: endpoint.id }] });
});

it("retires queued validation when Activity hides and restores the real form", async () => {
	const client = mount();
	const user = userEvent.setup();
	await user.click(screen.getAllByRole("button", { name: "Add Webhook" })[0]);
	await user.type(await screen.findByRole("textbox", { name: "Name" }), endpoint.name);
	await user.type(screen.getByRole("textbox", { name: "Endpoint URL" }), endpoint.url);
	await user.click(screen.getByRole("checkbox", { name: "absence_request_approved" }));
	await act(async () => {
		fireEvent.submit(
			screen.getByRole("button", { name: "Create Webhook", exact: true }).closest("form")!,
		);
		views.get(client)!.rerender(<Workspace client={client} visible={false} />);
	});
	await showWorkspace(client, true);
	expect(createWebhook).not.toHaveBeenCalled();
	expect(screen.getByDisplayValue(endpoint.name)).toBeTruthy();
	vi.mocked(createWebhook).mockResolvedValue(success as Awaited<ReturnType<typeof createWebhook>>);
	fireEvent.submit(
		screen.getByRole("button", { name: "Create Webhook", exact: true }).closest("form")!,
	);
	expect(await screen.findByRole("dialog", { name: "Webhook Secret" })).toBeTruthy();
});

it("holds one dispatched command across Activity reconnect and accepts a fresh submit after settlement", async () => {
	const pending = holdCreate();
	const client = mount();
	await submitCreate();
	await showWorkspace(client, false);
	await showWorkspace(client, true);
	const submit = screen.getByRole("button", { name: "Create Webhook", exact: true });
	expect(submit.hasAttribute("disabled")).toBe(true);
	fireEvent.submit(submit.closest("form")!);
	expect(createWebhook).toHaveBeenCalledTimes(1);
	await act(async () => pending.resolve(success as Awaited<ReturnType<typeof createWebhook>>));
	expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	expect(screen.getByDisplayValue(endpoint.name)).toBeTruthy();
	vi.mocked(createWebhook).mockResolvedValue(success as Awaited<ReturnType<typeof createWebhook>>);
	fireEvent.submit(submit.closest("form")!);
	expect(await screen.findByRole("dialog", { name: "Webhook Secret" })).toBeTruthy();
	expect(createWebhook).toHaveBeenCalledTimes(2);
});
