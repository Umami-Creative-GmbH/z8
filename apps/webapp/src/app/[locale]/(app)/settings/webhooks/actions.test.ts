import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	createWebhookEndpoint: vi.fn(),
	updateWebhookEndpoint: vi.fn(),
	deleteWebhookEndpoint: vi.fn(),
	getWebhookEndpoint: vi.fn(),
	getWebhookEndpointsByOrganization: vi.fn(),
	regenerateWebhookSecret: vi.fn(),
	getDeliveryLogs: vi.fn(),
	createDeliveryRecord: vi.fn(),
	addWebhookJob: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});
vi.mock("@/lib/webhooks", () => ({
	createWebhookEndpoint: mocks.createWebhookEndpoint,
	updateWebhookEndpoint: mocks.updateWebhookEndpoint,
	deleteWebhookEndpoint: mocks.deleteWebhookEndpoint,
	getWebhookEndpoint: mocks.getWebhookEndpoint,
	getWebhookEndpointsByOrganization: mocks.getWebhookEndpointsByOrganization,
	regenerateWebhookSecret: mocks.regenerateWebhookSecret,
	getDeliveryLogs: mocks.getDeliveryLogs,
	createDeliveryRecord: mocks.createDeliveryRecord,
}));
vi.mock("@/lib/webhooks/webhook-queue", () => ({ addWebhookJob: mocks.addWebhookJob }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const {
	createWebhook,
	deleteWebhook,
	getAvailableEventTypes,
	getWebhookDeliveryLogs,
	getWebhooks,
	regenerateSecret,
	testWebhook,
	updateWebhook,
} = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: { id: "employee-owner", role: "admin", former: false },
};
const orgAdmin: StubCaller = { ...owner, userId: "user-admin", membershipRole: "admin" };
const endpoint = { id: "webhook-1", organizationId: "org-1", url: "https://hooks.example.com/z8" };
const createInput = {
	name: " Payroll ",
	url: "https://hooks.example.com/z8",
	subscribedEvents: ["absence_request_approved"],
};

const actions = [
	["createWebhook", () => createWebhook(createInput)],
	["updateWebhook", () => updateWebhook({ webhookId: "webhook-1", isActive: false })],
	["deleteWebhook", () => deleteWebhook("webhook-1")],
	["regenerateSecret", () => regenerateSecret("webhook-1")],
	["testWebhook", () => testWebhook("webhook-1")],
	["getWebhooks", () => getWebhooks()],
	["getWebhookDeliveryLogs", () => getWebhookDeliveryLogs({ webhookId: "webhook-1" })],
	["getAvailableEventTypes", () => getAvailableEventTypes()],
] as const;

const sideEffects = () => [
	mocks.createWebhookEndpoint,
	mocks.updateWebhookEndpoint,
	mocks.deleteWebhookEndpoint,
	mocks.regenerateWebhookSecret,
	mocks.createDeliveryRecord,
	mocks.addWebhookJob,
	mocks.getWebhookEndpointsByOrganization,
	mocks.getDeliveryLogs,
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = owner;
	mocks.getWebhookEndpoint.mockResolvedValue(endpoint);
	mocks.createWebhookEndpoint.mockResolvedValue({ endpoint, secret: "whsec_once" });
	mocks.updateWebhookEndpoint.mockResolvedValue({ ...endpoint, isActive: false });
	mocks.deleteWebhookEndpoint.mockResolvedValue(true);
	mocks.regenerateWebhookSecret.mockResolvedValue({ secret: "whsec_new" });
	mocks.getWebhookEndpointsByOrganization.mockResolvedValue([endpoint]);
	mocks.getDeliveryLogs.mockResolvedValue({ deliveries: [], total: 0 });
	mocks.createDeliveryRecord.mockResolvedValue("delivery-1");
	mocks.addWebhookJob.mockResolvedValue(undefined);
});

describe("webhook actions", () => {
	it.each(actions)("lets an owner run %s", async (_name, run) => {
		expect(await run()).toMatchObject({ success: true });
	});

	it.each(actions)(
		"refuses %s to an org admin, since webhooks stay owner-only",
		async (_name, run) => {
			mocks.caller = orgAdmin;

			expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
			for (const sideEffect of sideEffects()) expect(sideEffect).not.toHaveBeenCalled();
		},
	);

	it.each([
		["a former owner", { ...owner, employee: { id: "e", role: "admin" as const, former: true } }],
		["a pending membership", { ...owner, membershipRole: null }],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		expect(await createWebhook(createInput)).toMatchObject({ success: false });
		expect(mocks.createWebhookEndpoint).not.toHaveBeenCalled();
	});

	it("creates the webhook in the session's organization with trimmed fields", async () => {
		await createWebhook({ ...createInput, organizationId: "org-other" } as typeof createInput);
		expect(mocks.createWebhookEndpoint).not.toHaveBeenCalled();

		await createWebhook(createInput);
		expect(mocks.createWebhookEndpoint).toHaveBeenCalledWith({
			organizationId: "org-1",
			name: "Payroll",
			url: "https://hooks.example.com/z8",
			subscribedEvents: ["absence_request_approved"],
			description: undefined,
			createdBy: "user-owner",
		});
	});

	it.each([
		[
			"a private address",
			{ url: "http://127.0.0.1/hook" },
			"Webhook URLs cannot target private or internal addresses",
		],
		["no events", { subscribedEvents: [] }, "At least one event must be selected"],
		["an unknown event", { subscribedEvents: ["nope"] }, "Invalid event type(s) selected"],
	])("refuses to create a webhook with %s", async (_case, overrides, error) => {
		expect(await createWebhook({ ...createInput, ...overrides })).toMatchObject({
			success: false,
			code: "ValidationError",
			error,
		});
		expect(mocks.createWebhookEndpoint).not.toHaveBeenCalled();
	});

	it.each([
		["updateWebhook", () => updateWebhook({ webhookId: "webhook-other", isActive: false })],
		["deleteWebhook", () => deleteWebhook("webhook-other")],
		["regenerateSecret", () => regenerateSecret("webhook-other")],
		["testWebhook", () => testWebhook("webhook-other")],
		["getWebhookDeliveryLogs", () => getWebhookDeliveryLogs({ webhookId: "webhook-other" })],
	] as const)("%s treats another organization's webhook as not found", async (_name, run) => {
		mocks.getWebhookEndpoint.mockResolvedValue(null);

		expect(await run()).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.getWebhookEndpoint).toHaveBeenCalledWith("webhook-other", "org-1");
		for (const sideEffect of sideEffects()) expect(sideEffect).not.toHaveBeenCalled();
	});

	it("queues the test delivery for the session's organization", async () => {
		expect(await testWebhook("webhook-1")).toEqual({
			success: true,
			data: { deliveryId: "delivery-1" },
		});
		expect(mocks.addWebhookJob).toHaveBeenCalledWith(
			expect.objectContaining({ deliveryId: "delivery-1", organizationId: "org-1" }),
		);
	});

	it("pages delivery logs", async () => {
		mocks.getDeliveryLogs.mockResolvedValue({ deliveries: [{ id: "d1" }], total: 3 });

		expect(await getWebhookDeliveryLogs({ webhookId: "webhook-1", limit: 1, offset: 1 })).toEqual({
			success: true,
			data: { deliveries: [{ id: "d1" }], total: 3, hasMore: true },
		});
		expect(mocks.getDeliveryLogs).toHaveBeenCalledWith("webhook-1", "org-1", {
			limit: 1,
			offset: 1,
		});
	});
});
