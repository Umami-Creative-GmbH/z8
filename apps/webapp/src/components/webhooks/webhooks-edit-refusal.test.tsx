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
import {
	deleteWebhook,
	regenerateSecret,
	testWebhook,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/webhooks/actions";
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
							initialWebhooks={seed}
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

const seed = [endpoint];
const queryKey = ["developerWebhooks", "synthetic-org", "synthetic-admin"];
function holdUpdate() {
	let resolve!: (value: Awaited<ReturnType<typeof updateWebhook>>) => void;
	vi.mocked(updateWebhook).mockImplementation(
		() =>
			new Promise((yes) => {
				resolve = yes;
			}),
	);
	return (value: Awaited<ReturnType<typeof updateWebhook>>) => resolve(value);
}
async function editAndDispatch() {
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Actions", exact: true }));
	await user.click(await screen.findByRole("menuitem", { name: "Edit", exact: true }));
	const name = await screen.findByRole("textbox", { name: "Name" });
	await user.clear(name);
	await user.type(name, "Independent edited draft");
	fireEvent.submit(screen.getByRole("button", { name: "Save", exact: true }).closest("form")!);
	await waitFor(() => expect(updateWebhook).toHaveBeenCalledTimes(1));
}
const updated = {
	success: true as const,
	data: { endpoint: { ...endpoint, name: "Independent edited draft" } },
};
it("independent control: normal edit confirms its endpoint and feedback", async () => {
	vi.mocked(updateWebhook).mockResolvedValue(updated as Awaited<ReturnType<typeof updateWebhook>>);
	const client = mount();
	await editAndDispatch();
	await waitFor(() => expect(transport.success).toHaveBeenCalledTimes(1));
	expect(client.getQueryData(queryKey)).toMatchObject({
		success: true,
		data: [{ name: "Independent edited draft" }],
	});
	expect(transport.refresh).toHaveBeenCalledTimes(1);
});
it("independent control: settled refused read retires an old edit", async () => {
	const finish = holdUpdate();
	const client = mount();
	await editAndDispatch();
	await refuseRead(client);
	await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Webhook" })).toBeNull());
	const refreshes = transport.refresh.mock.calls.length;
	await act(async () => finish(updated as Awaited<ReturnType<typeof updateWebhook>>));
	expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
	expect(transport.success).not.toHaveBeenCalled();
	expect(transport.error).not.toHaveBeenCalled();
	expect(transport.refresh).toHaveBeenCalledTimes(refreshes);
});
it("independent critical: edit settlement immediately after authoritative cache refusal has no success effects", async () => {
	const finish = holdUpdate();
	const client = mount();
	await editAndDispatch();
	let refusedBeforeSettlement = false;
	const unsubscribe = client.getQueryCache().subscribe(() => {
		const snapshot = client.getQueryData<{ success: boolean }>(queryKey);
		if (!refusedBeforeSettlement && snapshot?.success === false) {
			refusedBeforeSettlement = true;
			finish(updated as Awaited<ReturnType<typeof updateWebhook>>);
		}
	});
	const refreshes = transport.refresh.mock.calls.length;
	try {
		await refuseRead(client);
	} finally {
		unsubscribe();
	}
	expect(refusedBeforeSettlement).toBe(true);
	const observed = {
		refusedCacheRetained: client.getQueryData<{ success: boolean }>(queryKey)?.success === false,
		successToasts: transport.success.mock.calls.length,
		errorToasts: transport.error.mock.calls.length,
		lateRefreshes: transport.refresh.mock.calls.length - refreshes,
		secretVisible: !!screen.queryByRole("dialog", { name: "Webhook Secret" }),
	};
	expect(observed).toEqual({
		refusedCacheRetained: true,
		successToasts: 0,
		errorToasts: 0,
		lateRefreshes: 0,
		secretVisible: false,
	});
});
type CardCommand = "toggle" | "delete" | "test" | "rotate";
function holdCardCommand(command: CardCommand) {
	let finish!: () => void;
	if (command === "toggle")
		vi.mocked(updateWebhook).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve(updated as Awaited<ReturnType<typeof updateWebhook>>);
				}),
		);
	if (command === "delete")
		vi.mocked(deleteWebhook).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ success: true, data: undefined });
				}),
		);
	if (command === "test")
		vi.mocked(testWebhook).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ success: true, data: { deliveryId: "synthetic-delivery" } });
				}),
		);
	if (command === "rotate")
		vi.mocked(regenerateSecret).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () =>
						resolve({
							success: true,
							data: { secret: "SYNTHETIC_INVALID_ROTATION_NOT_A_CREDENTIAL" },
						});
				}),
		);
	return () => finish();
}
async function dispatchCardCommand(command: CardCommand) {
	const user = userEvent.setup();
	if (command === "toggle") {
		await user.click(screen.getByRole("switch", { name: "Toggle webhook active" }));
		await waitFor(() => expect(updateWebhook).toHaveBeenCalledTimes(1));
		return;
	}
	await user.click(screen.getByRole("button", { name: "Actions", exact: true }));
	const label = { delete: "Delete", test: "Send Test", rotate: "Regenerate Secret" }[command];
	await user.click(await screen.findByRole("menuitem", { name: label, exact: true }));
	if (command === "delete")
		await user.click(await screen.findByRole("button", { name: "Delete", exact: true }));
	const action = { delete: deleteWebhook, test: testWebhook, rotate: regenerateSecret }[command];
	await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
}
it.each(["toggle", "delete", "test", "rotate"] as const)(
	"accepts a current %s command completion",
	async (command) => {
		const finish = holdCardCommand(command);
		mount();
		await dispatchCardCommand(command);
		await act(async () => finish());
		expect(transport.success).toHaveBeenCalledTimes(1);
		expect(transport.error).not.toHaveBeenCalled();
		if (command === "rotate")
			expect(await screen.findByRole("dialog", { name: "Webhook Secret" })).toBeTruthy();
	},
);
it.each(["toggle", "delete", "test", "rotate"] as const)(
	"retires %s completion at cache refusal before the observer commits",
	async (command) => {
		const finish = holdCardCommand(command);
		const client = mount();
		await dispatchCardCommand(command);
		let settled = false;
		const unsubscribe = client.getQueryCache().subscribe(() => {
			if (!settled && client.getQueryData<{ success: boolean }>(queryKey)?.success === false) {
				settled = true;
				finish();
			}
		});
		const refreshes = transport.refresh.mock.calls.length;
		try {
			await refuseRead(client);
		} finally {
			unsubscribe();
		}
		expect(settled).toBe(true);
		expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
		expect(transport.success).not.toHaveBeenCalled();
		expect(transport.error).not.toHaveBeenCalled();
		expect(transport.refresh).toHaveBeenCalledTimes(refreshes);
		expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	},
);

it.each(["toggle", "delete", "test", "rotate"] as const)(
	"keeps a dispatched %s command locked through Activity retirement until settlement",
	async (command) => {
		const finish = holdCardCommand(command);
		const client = mount();
		await dispatchCardCommand(command);
		await act(async () => {
			views.get(client)!.rerender(<Workspace client={client} visible={false} />);
		});
		await act(async () => {
			views.get(client)!.rerender(<Workspace client={client} />);
		});
		const control =
			command === "toggle"
				? screen.getByRole("switch", { name: "Toggle webhook active" })
				: command === "delete"
					? screen.getByRole("button", { name: "Delete", exact: true })
					: screen.getByRole("button", { name: "Actions", exact: true });
		expect(control.hasAttribute("disabled")).toBe(true);
		await act(async () => finish());
		await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false));
		expect(transport.success).not.toHaveBeenCalled();
		expect(transport.error).not.toHaveBeenCalled();
		expect(transport.refresh).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
	},
);
