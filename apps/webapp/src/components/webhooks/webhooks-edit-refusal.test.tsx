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

const transport = vi.hoisted(() => ({
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	tab: "webhooks",
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "synthetic-admin" }, session: { activeOrganizationId: "synthetic-org" } },
		isPending: false,
	}),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: transport.refresh, replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams({ tab: transport.tab }),
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
	transport.tab = "webhooks";
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

function Workspace({
	client,
	visible = true,
	webhooks = seed,
	webhooksError = false,
}: {
	client: QueryClient;
	visible?: boolean;
	webhooks?: typeof seed;
	webhooksError?: boolean;
}) {
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
							initialApiKeys={emptyKeys}
							initialKeysError={false}
							initialWebhooks={webhooks}
							initialWebhooksError={webhooksError}
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
function currentView(client: QueryClient) {
	const view = views.get(client);
	if (!view) throw new Error("Missing rendered workspace");
	return view;
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
const emptyKeys: [] = [];
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
	const form = screen.getByRole("button", { name: "Save", exact: true }).closest("form");
	if (!form) throw new Error("Missing edit form");
	fireEvent.submit(form);
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
			currentView(client).rerender(<Workspace client={client} visible={false} />);
		});
		await act(async () => {
			currentView(client).rerender(<Workspace client={client} />);
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
it("new control: current edit refusal preserves the nonsecret draft and reports failure", async () => {
	vi.mocked(updateWebhook).mockResolvedValue({
		success: false,
		error: "SYNTHETIC_EDIT_REFUSAL",
		code: "AuthorizationError",
	});
	mount();
	await editAndDispatch();
	await waitFor(() => expect(transport.error).toHaveBeenCalledTimes(1));
	expect(screen.getByDisplayValue("Independent edited draft")).toBeTruthy();
	expect(transport.success).not.toHaveBeenCalled();
});
it("new control: current edit transport rejection reports unknown failure", async () => {
	vi.mocked(updateWebhook).mockRejectedValue(new Error("SYNTHETIC_TRANSPORT_REJECTION"));
	mount();
	await editAndDispatch();
	await waitFor(() => expect(transport.error).toHaveBeenCalledTimes(1));
	expect(screen.getByDisplayValue("Independent edited draft")).toBeTruthy();
	expect(transport.success).not.toHaveBeenCalled();
});
it("new control: transient list transport failure permits current successful edit", async () => {
	const finish = holdUpdate();
	const client = mount();
	await editAndDispatch();
	vi.mocked(readWebhooksForView).mockRejectedValue(new Error("SYNTHETIC_READ_TRANSPORT"));
	await act(async () => {
		await client.invalidateQueries({ queryKey });
	});
	expect(client.getQueryData(queryKey)).toMatchObject({ success: true });
	await act(async () => finish(updated as Awaited<ReturnType<typeof updateWebhook>>));
	await waitFor(() => expect(transport.success).toHaveBeenCalledTimes(1));
	expect(transport.error).not.toHaveBeenCalled();
	expect(transport.refresh).toHaveBeenCalledTimes(1);
});
it("new objection: settled authoritative refusal survives Activity reconnect without Retry", async () => {
	const client = mount();
	await refuseRead(client);
	await waitFor(() => expect(screen.queryByText(endpoint.name)).toBeNull());
	expect(
		screen.getByRole("button", { name: "Add Webhook", exact: true }).hasAttribute("disabled"),
	).toBe(true);
	const readCount = vi.mocked(readWebhooksForView).mock.calls.length;
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} visible={false} />),
	);
	await act(async () => currentView(client).rerender(<Workspace client={client} />));
	const observed = {
		cacheStillRefused: client.getQueryData<{ success: boolean }>(queryKey)?.success === false,
		staleEndpointVisible: !!screen.queryByText(endpoint.name),
		createDisabled: screen
			.getByRole("button", { name: "Add Webhook", exact: true })
			.hasAttribute("disabled"),
		extraReadCalls: vi.mocked(readWebhooksForView).mock.calls.length - readCount,
	};
	expect(observed).toEqual({
		cacheStillRefused: true,
		staleEndpointVisible: false,
		createDisabled: true,
		extraReadCalls: 0,
	});
});
it("new objection: cache refusal before observer commit suppresses old edit refusal feedback", async () => {
	const finish = holdUpdate();
	const client = mount();
	await editAndDispatch();
	let settledAtRefusal = false;
	let editPanelStillMountedAtRefusal = false;
	const unsubscribe = client.getQueryCache().subscribe(() => {
		if (
			!settledAtRefusal &&
			client.getQueryData<{ success: boolean }>(queryKey)?.success === false
		) {
			settledAtRefusal = true;
			editPanelStillMountedAtRefusal = !!screen.queryByRole("dialog", { name: "Edit Webhook" });
			finish({ success: false, error: "SYNTHETIC_OLD_EDIT_REFUSAL", code: "AuthorizationError" });
		}
	});
	const refreshes = transport.refresh.mock.calls.length;
	try {
		await refuseRead(client);
	} finally {
		unsubscribe();
	}
	await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Webhook" })).toBeNull());
	expect(settledAtRefusal).toBe(true);
	expect(editPanelStillMountedAtRefusal).toBe(true);
	expect(client.getQueryData(queryKey)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(transport.success).not.toHaveBeenCalled();
	expect(transport.refresh).toHaveBeenCalledTimes(refreshes);
	expect(transport.error.mock.calls).toEqual([]);
});

it("keeps API-key refusal through Activity reconnect with the same server snapshot", async () => {
	transport.tab = "keys";
	const client = mount();
	const keysQuery = ["apiKeys", "synthetic-org", "synthetic-admin"];
	vi.mocked(readApiKeysForView).mockResolvedValue({
		success: false,
		error: "Synthetic key refusal",
		code: "AuthorizationError",
	});
	await act(async () => {
		await client.invalidateQueries({ queryKey: keysQuery });
	});
	await waitFor(() => expect(client.getQueryData(keysQuery)).toMatchObject({ success: false }));
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} visible={false} />),
	);
	await act(async () => currentView(client).rerender(<Workspace client={client} />));
	expect(client.getQueryData(keysQuery)).toMatchObject({ success: false });
	expect(screen.getByRole("button", { name: "Create Key", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
});
it.each(["populated", "empty"] as const)(
	"accepts a fresh %s server snapshot after refusal",
	async (kind) => {
		const client = mount();
		await refuseRead(client);
		const fresh = kind === "empty" ? [] : [{ ...endpoint, name: "Fresh authorized endpoint" }];
		await act(async () =>
			currentView(client).rerender(<Workspace client={client} webhooks={fresh} />),
		);
		expect(client.getQueryData(queryKey)).toMatchObject({ success: true, data: fresh });
		if (kind === "populated")
			expect(await screen.findByText("Fresh authorized endpoint")).toBeTruthy();
		else
			expect(await screen.findByRole("heading", { name: "No webhooks configured" })).toBeTruthy();
		await act(async () =>
			currentView(client).rerender(<Workspace client={client} visible={false} webhooks={fresh} />),
		);
		await act(async () =>
			currentView(client).rerender(<Workspace client={client} webhooks={fresh} />),
		);
		expect(client.getQueryData(queryKey)).toMatchObject({ success: true, data: fresh });
	},
);
it("does not roll a local current edit back on Activity reconnect", async () => {
	vi.mocked(updateWebhook).mockResolvedValue(updated);
	const client = mount();
	await editAndDispatch();
	await waitFor(() => expect(screen.getByText("Independent edited draft")).toBeTruthy());
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} visible={false} />),
	);
	await act(async () => currentView(client).rerender(<Workspace client={client} />));
	expect(client.getQueryData(queryKey)).toMatchObject({
		success: true,
		data: [{ name: "Independent edited draft" }],
	});
});
it("keeps refusal when the same server snapshot remounts under the retained query client", async () => {
	const client = mount();
	await refuseRead(client);
	currentView(client).unmount();
	views.set(client, render(<Workspace client={client} />));
	expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
	expect(screen.queryByText(endpoint.name)).toBeNull();
});
it("requires a fresh read after a consumed snapshot query was removed", async () => {
	const client = mount();
	await refuseRead(client);
	currentView(client).unmount();
	client.removeQueries({ queryKey, exact: true });
	vi.mocked(readWebhooksForView).mockImplementation(() => new Promise(() => {}));
	const before = vi.mocked(readWebhooksForView).mock.calls.length;
	views.set(client, render(<Workspace client={client} />));
	await waitFor(() => expect(readWebhooksForView).toHaveBeenCalledTimes(before + 1));
	expect(client.getQueryData(queryKey)).toBeUndefined();
	expect(screen.queryByText(endpoint.name)).toBeNull();
	expect(screen.getByRole("button", { name: "Add Webhook", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
});
it("does not reapply an old consumed snapshot after a newer arrival and refusal", async () => {
	const client = mount();
	const fresh = [{ ...endpoint, name: "Newer server endpoint" }];
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} webhooks={fresh} />),
	);
	await refuseRead(client);
	await act(async () => currentView(client).rerender(<Workspace client={client} />));
	expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
	expect(screen.queryByText(endpoint.name)).toBeNull();
});

it("retains an authoritative refusal when replacement server props report a read failure", async () => {
	const client = mount();
	await refuseRead(client);
	const failed = [{ ...endpoint, name: "Failed snapshot must stay hidden" }];
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} webhooks={failed} webhooksError />),
	);
	expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
	expect(screen.queryByText("Failed snapshot must stay hidden")).toBeNull();
});
it("applies a genuinely fresh snapshot received while Activity was hidden", async () => {
	const client = mount();
	await refuseRead(client);
	const fresh = [{ ...endpoint, name: "Fresh after return" }];
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} visible={false} webhooks={fresh} />),
	);
	expect(client.getQueryData(queryKey)).toMatchObject({ success: false });
	await act(async () =>
		currentView(client).rerender(<Workspace client={client} webhooks={fresh} />),
	);
	expect(await screen.findByText("Fresh after return")).toBeTruthy();
	expect(client.getQueryData(queryKey)).toMatchObject({ success: true, data: fresh });
});
