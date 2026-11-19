// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeveloperAccessClient } from "@/app/[locale]/(app)/settings/enterprise/api-keys/page-client";
import {
	readApiKeysForView,
	readWebhooksForView,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import { render } from "@/test/render-with-translations";

const seam = vi.hoisted(() => ({
	user: "review-actor",
	org: "review-org",
	pending: false,
	tab: "webhooks",
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: seam.user }, session: { activeOrganizationId: seam.org } },
		isPending: seam.pending,
	}),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: seam.refresh, replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams({ tab: seam.tab }),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: seam.refresh, replace: vi.fn() }) }));
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
	testWebhook: vi.fn(),
	regenerateSecret: vi.fn(),
	getWebhookDeliveryLogs: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: seam.success, error: seam.error } }));
const clients: QueryClient[] = [];
let tick = 0;
const endpoint = {
	id: "review-endpoint",
	organizationId: "review-org",
	name: "Review endpoint",
	url: "https://example.invalid/independent",
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
type Snap = (typeof endpoint)[];
const emptyKeys: [] = [];
const key = () => [seam.tab === "keys" ? "apiKeys" : "developerWebhooks", seam.org, seam.user];
const reader = () =>
	seam.tab === "keys" ? vi.mocked(readApiKeysForView) : vi.mocked(readWebhooksForView);
const failure = (code = "AuthorizationError") => ({
	success: false as const,
	error: "SYNTHETIC_REFUSAL",
	code,
});
function makeClient() {
	const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
	clients.push(c);
	return c;
}
function Workspace({
	client,
	snapshot,
	visible = true,
	employeeRole = null,
	employee = null,
	failed = false,
	access = "owner",
	keySnapshot = emptyKeys,
}: {
	client: QueryClient;
	snapshot: Snap;
	visible?: boolean;
	employeeRole?: "admin" | "employee" | null;
	employee?: string | null;
	failed?: boolean;
	access?: "owner" | "orgAdmin";
	keySnapshot?: ApiKeyResponse[];
}) {
	return (
		<StrictMode>
			<QueryClientProvider client={client}>
				<OrganizationContextProvider
					initialContext={{
						userId: seam.user,
						organizationId: seam.org,
						employee: employee
							? { employeeId: employee, organizationId: seam.org, role: employeeRole ?? "employee" }
							: null,
						organizationSettings: null,
						updatedAt: tick,
					}}
				>
					<ViewRefreshProvider>
						<Activity mode={visible ? "visible" : "hidden"}>
							<DeveloperAccessClient
								organizationId={seam.org}
								currentUserId={seam.user}
								settingsAccess={access}
								initialApiKeys={keySnapshot}
								initialKeysError={false}
								initialWebhooks={snapshot}
								initialWebhooksError={failed}
							/>
						</Activity>
					</ViewRefreshProvider>
				</OrganizationContextProvider>
			</QueryClientProvider>
		</StrictMode>
	);
}
beforeEach(() => {
	vi.resetAllMocks();
	seam.user = "review-actor";
	seam.org = "review-org";
	seam.tab = "webhooks";
	seam.pending = false;
	tick = Date.now();
	vi.mocked(readApiKeysForView).mockResolvedValue({ success: true, data: [] });
	vi.mocked(readWebhooksForView).mockResolvedValue({ success: true, data: [] });
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						user: { id: seam.user },
						session: { activeOrganizationId: seam.org },
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
	for (const c of clients.splice(0)) c.clear();
	vi.unstubAllGlobals();
});
async function refuse(client: QueryClient, code: "AuthenticationError" | "AuthorizationError") {
	reader().mockResolvedValue(failure(code));
	await act(async () => {
		await client.invalidateQueries({ queryKey: key(), exact: true });
	});
	await waitFor(() => expect(client.getQueryData(key())).toMatchObject(failure(code)));
	await screen.findAllByText(seam.tab === "keys" ? "API keys unavailable" : "Webhooks unavailable");
}
function assertRefusal(client: QueryClient, code: string) {
	expect(client.getQueryData(key())).toMatchObject(failure(code));
	expect(screen.queryByText(endpoint.name)).toBeNull();
	expect(
		screen.getByRole("button", {
			name: seam.tab === "keys" ? "Create Key" : "Add Webhook",
			exact: true,
		}),
	).toHaveProperty("disabled", true);
}
it.each(["keys", "webhooks"] as const)(
	"independent %s control: current successful empty RSC array reconciles after AuthenticationError",
	async (tab) => {
		seam.tab = tab;
		const c = makeClient();
		const original = [{ ...endpoint }];
		const v = render(<Workspace client={c} snapshot={original} />);
		await refuse(c, "AuthenticationError");
		const fresh: Snap = [];
		v.rerender(<Workspace client={c} snapshot={fresh} />);
		if (tab === "keys") {
			// The API-key snapshot remains the same, so its refusal must not be cleared by a webhook arrival.
			assertRefusal(c, "AuthenticationError");
		} else {
			await screen.findByRole("heading", { name: "No webhooks configured" });
			expect(c.getQueryData(key())).toEqual({ success: true, data: [] });
		}
	},
);
it.each(["AuthorizationError", "AuthenticationError"] as const)(
	"independent %s survives repeated StrictMode Activity, employee/role remount, and same-client tree remount",
	async (code) => {
		const c = makeClient();
		const snapshot = [{ ...endpoint }];
		let v = render(<Workspace client={c} snapshot={snapshot} />);
		await refuse(c, code);
		for (let i = 0; i < 3; i++) {
			v.rerender(<Workspace client={c} snapshot={snapshot} visible={false} />);
			v.rerender(<Workspace client={c} snapshot={snapshot} />);
			assertRefusal(c, code);
		}
		tick += 100;
		v.rerender(
			<Workspace
				client={c}
				snapshot={snapshot}
				employee="review-employee"
				employeeRole="employee"
			/>,
		);
		await waitFor(() => assertRefusal(c, code));
		tick += 100;
		v.rerender(
			<Workspace
				client={c}
				snapshot={snapshot}
				employee="review-employee"
				employeeRole="admin"
				access="orgAdmin"
			/>,
		);
		await waitFor(() => assertRefusal(c, code));
		v.unmount();
		v = render(<Workspace client={c} snapshot={snapshot} />);
		assertRefusal(c, code);
	},
);
it("independent client isolation: consuming one array cannot starve a second QueryClient", async () => {
	const snapshot = [{ ...endpoint }];
	const a = makeClient();
	const b = makeClient();
	const v = render(<Workspace client={a} snapshot={snapshot} />);
	await refuse(a, "AuthorizationError");
	v.unmount();
	render(<Workspace client={b} snapshot={snapshot} />);
	await screen.findByText(endpoint.name);
	expect(b.getQueryData(key())).toMatchObject({ success: true, data: snapshot });
	expect(a.getQueryData(key())).toMatchObject({ success: false });
});
it.each(["actor", "organization"] as const)(
	"independent %s scope ABA retains its own refusal and does not inherit another scope",
	async (kind) => {
		const c = makeClient();
		const snapshot = [{ ...endpoint }];
		const v = render(<Workspace client={c} snapshot={snapshot} />);
		await refuse(c, "AuthenticationError");
		const originalKey = key();
		if (kind === "actor") seam.user = "review-other-actor";
		else seam.org = "review-other-org";
		tick += 100;
		v.rerender(<Workspace client={c} snapshot={[]} />);
		await screen.findByRole("heading", { name: "No webhooks configured" });
		expect(c.getQueryData(originalKey)).toMatchObject({ success: false });
		seam.user = "review-actor";
		seam.org = "review-org";
		tick += 100;
		v.rerender(<Workspace client={c} snapshot={snapshot} />);
		await waitFor(() => assertRefusal(c, "AuthenticationError"));
	},
);
it("independent retained cache control: fresh-mount success may recover with a genuinely new server object", async () => {
	const c = makeClient();
	const snapshot = [{ ...endpoint }];
	const v = render(<Workspace client={c} snapshot={snapshot} />);
	await refuse(c, "AuthorizationError");
	v.unmount();
	const fresh = [{ ...endpoint, name: "Fresh mount endpoint" }];
	render(<Workspace client={c} snapshot={fresh} />);
	await screen.findByText("Fresh mount endpoint");
	expect(c.getQueryData(key())).toMatchObject({ success: true, data: fresh });
});
it("independent early hidden arrival: an old server object rendered before refusal must not restore authority when first exposed", async () => {
	const c = makeClient();
	const seedA = [{ ...endpoint }];
	const seedB = [{ ...endpoint, name: "Previously hidden old endpoint" }];
	const tree = (showB = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={seedA} />
			</section>
			<section data-testid="parked-tree">
				<Workspace client={c} snapshot={seedB} visible={showB} />
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	await refuse(c, "AuthorizationError");
	expect(
		within(screen.getByTestId("parked-tree")).queryByText("Previously hidden old endpoint"),
	).toBeNull();
	const reads = vi.mocked(readWebhooksForView).mock.calls.length;
	v.rerender(tree(true));
	const observed = {
		refusalPreserved: c.getQueryData<{ success: boolean }>(key())?.success === false,
		oldEndpointExposed: screen.queryAllByText("Previously hidden old endpoint").length > 0,
		extraReads: vi.mocked(readWebhooksForView).mock.calls.length - reads,
	};
	expect(observed).toEqual({ refusalPreserved: true, oldEndpointExposed: false, extraReads: 0 });
});

it("retains first observation when an uncommitted hidden source is remounted after refusal", async () => {
	const c = makeClient();
	const a = [{ ...endpoint }];
	const b = [{ ...endpoint, name: "Old hidden remount" }];
	const tree = (show = false, employee: string | null = null) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={a} />
			</section>
			<section data-testid="parked-tree">
				<Workspace
					client={c}
					snapshot={b}
					visible={show}
					employee={employee}
					employeeRole={employee ? "employee" : null}
				/>
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	await refuse(c, "AuthorizationError");
	tick += 100;
	v.rerender(tree(false, "replacement-employee"));
	v.rerender(tree(true, "replacement-employee"));
	await waitFor(() => expect(c.getQueryData(key())).toMatchObject(failure()));
	expect(screen.queryAllByText("Old hidden remount")).toHaveLength(0);
});
it("does not revive a pre-refusal hidden source after query removal and recreation", async () => {
	const c = makeClient();
	const a = [{ ...endpoint }];
	const b = [{ ...endpoint, name: "Old before removal" }];
	const tree = (show = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={a} />
			</section>
			<section data-testid="parked-tree">
				<Workspace client={c} snapshot={b} visible={show} />
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	await refuse(c, "AuthorizationError");
	act(() => c.removeQueries({ queryKey: key(), exact: true }));
	v.rerender(tree(true));
	await waitFor(() => expect(c.getQueryData(key())).toMatchObject(failure()));
	expect(screen.queryAllByText("Old before removal")).toHaveLength(0);
});
it("does not confuse reset query counters with the earlier hidden arrival", async () => {
	const c = makeClient();
	const a = [{ ...endpoint }];
	const b = [{ ...endpoint, name: "Old before reset" }];
	const tree = (show = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={a} />
			</section>
			<section data-testid="parked-tree">
				<Workspace client={c} snapshot={b} visible={show} />
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	await refuse(c, "AuthorizationError");
	const q = c.getQueryCache().find({ queryKey: key(), exact: true });
	if (!q) throw Error("Expected scoped query");
	act(() =>
		q.setState({ data: failure(), dataUpdateCount: 0, errorUpdateCount: 0, dataUpdatedAt: 0 }),
	);
	v.rerender(tree(true));
	expect(c.getQueryData(key())).toMatchObject(failure());
	expect(screen.queryAllByText("Old before reset")).toHaveLength(0);
});
it("accepts a genuinely post-refusal hidden arrival despite fetch-start bookkeeping", async () => {
	const c = makeClient();
	const a = [{ ...endpoint }];
	const fresh = [{ ...endpoint, name: "Current hidden arrival" }];
	const tree = (mounted = false, show = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={a} />
			</section>
			{mounted ? (
				<section data-testid="parked-tree">
					<Workspace client={c} snapshot={fresh} visible={show} />
				</section>
			) : null}
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	await refuse(c, "AuthorizationError");
	v.rerender(tree(true));
	const held = Promise.withResolvers<Awaited<ReturnType<typeof readWebhooksForView>>>();
	reader().mockReturnValue(held.promise);
	let refresh!: Promise<void>;
	act(() => {
		refresh = c.invalidateQueries({ queryKey: key(), exact: true });
	});
	v.rerender(tree(true, true));
	await within(screen.getByTestId("parked-tree")).findByText("Current hidden arrival");
	expect(c.getQueryData(key())).toMatchObject({ success: true, data: fresh });
	await act(async () => {
		held.resolve({ success: true, data: fresh });
		await refresh;
	});
});
it("keeps API-key refusal when a distinct pre-refusal hidden array first becomes visible", async () => {
	seam.tab = "keys";
	const c = makeClient();
	const a: ApiKeyResponse[] = [];
	const b: ApiKeyResponse[] = [];
	const dummy: Snap = [];
	const tree = (show = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={dummy} keySnapshot={a} />
			</section>
			<section data-testid="parked-tree">
				<Workspace client={c} snapshot={dummy} keySnapshot={b} visible={show} />
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findAllByRole("button", {
		name: "Create Key",
		exact: true,
	});
	await refuse(c, "AuthorizationError");
	v.rerender(tree(true));
	expect(c.getQueryData(key())).toMatchObject(failure());
	for (const button of within(screen.getByTestId("parked-tree")).getAllByRole("button", {
		name: "Create Key",
		exact: true,
	}))
		expect(button).toHaveProperty("disabled", true);
});

it("preserves a newer transport error and Retry when an older hidden source is exposed", async () => {
	const c = makeClient();
	const a = [{ ...endpoint }];
	const b = [{ ...endpoint, name: "Old hidden transport snapshot" }];
	const tree = (show = false) => (
		<>
			<section data-testid="active-tree">
				<Workspace client={c} snapshot={a} />
			</section>
			<section data-testid="parked-tree">
				<Workspace client={c} snapshot={b} visible={show} />
			</section>
		</>
	);
	const v = render(tree());
	await within(screen.getByTestId("active-tree")).findByText(endpoint.name);
	vi.mocked(readWebhooksForView).mockRejectedValue(
		new Error("Synthetic read transport unavailable"),
	);
	await act(async () => {
		await c.invalidateQueries({ queryKey: key(), exact: true });
	});
	await within(screen.getByTestId("active-tree")).findByText("Webhooks unavailable");
	v.rerender(tree(true));
	expect(c.getQueryState(key())?.status).toBe("error");
	expect(c.getQueryData(key())).toMatchObject({ success: true, data: a });
	expect(screen.queryAllByText("Old hidden transport snapshot")).toHaveLength(0);
	expect(
		await within(screen.getByTestId("parked-tree")).findByRole("button", {
			name: "Retry",
			exact: true,
		}),
	).toBeTruthy();
});

it.each(["webhooks", "keys"] as const)(
	"an unvisited %s panel cannot seed a snapshot received before refusal",
	async (namespace) => {
		seam.tab = namespace;
		const client = makeClient();
		const original = [{ ...endpoint }];
		const stale = [{ ...endpoint, name: "Unvisited old endpoint" }];
		const firstKeys: ApiKeyResponse[] = [];
		const staleKeys: ApiKeyResponse[] = [];
		const active = render(
			<Workspace client={client} snapshot={original} keySnapshot={firstKeys} />,
		);
		if (namespace === "webhooks") await screen.findByText(endpoint.name);
		else await screen.findAllByRole("button", { name: "Create Key", exact: true });
		seam.tab = namespace === "webhooks" ? "keys" : "webhooks";
		const parked = render(
			<section data-testid="unvisited-parked">
				<Workspace client={client} snapshot={stale} keySnapshot={staleKeys} visible={false} />
			</section>,
		);
		seam.tab = namespace;
		await refuse(client, "AuthorizationError");
		active.unmount();
		parked.rerender(
			<section data-testid="unvisited-parked">
				<Workspace client={client} snapshot={stale} keySnapshot={staleKeys} />
			</section>,
		);
		await waitFor(() =>
			expect(client.getQueryData(key())).toMatchObject(failure("AuthorizationError")),
		);
		if (namespace === "webhooks") expect(screen.queryByText("Unvisited old endpoint")).toBeNull();
		const button = screen.getByRole("button", {
			name: namespace === "keys" ? "Create Key" : "Add Webhook",
			exact: true,
		});
		expect(button).toHaveProperty("disabled", true);
		expect(seam.success).not.toHaveBeenCalled();
		expect(seam.error).not.toHaveBeenCalled();
		expect(seam.refresh).not.toHaveBeenCalled();
	},
);

it("observing the page snapshots does not create or read an unvisited panel query", async () => {
	seam.tab = "keys";
	const client = makeClient();
	render(<Workspace client={client} snapshot={[{ ...endpoint }]} />);
	await screen.findAllByRole("button", { name: "Create Key", exact: true });
	expect(client.getQueryState(["developerWebhooks", seam.org, seam.user])).toBeUndefined();
	expect(readWebhooksForView).not.toHaveBeenCalled();
});
