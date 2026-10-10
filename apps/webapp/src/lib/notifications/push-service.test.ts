import { generateKeyPairSync } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "./push-service";

const state = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	webSubscriptions: [] as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
	deviceTokens: [] as Array<{ id: string; token: string; platform: "ios" | "android" }>,
	updates: [] as Array<{ table: unknown; set: Record<string, unknown>; where: unknown }>,
	webPushSend: vi.fn(),
	deviceTokenQuery: vi.fn(),
}));

vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("web-push", () => ({
	default: { setVapidDetails: vi.fn(), sendNotification: state.webPushSend },
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			pushSubscription: { findMany: vi.fn(async () => state.webSubscriptions) },
			pushDeviceToken: {
				findMany: state.deviceTokenQuery.mockImplementation(async () => state.deviceTokens),
			},
			userSettings: { findFirst: vi.fn(async () => ({ locale: "en" })) },
			organizationNotificationSettings: { findFirst: vi.fn(async () => null) },
		},
		update: vi.fn((table: unknown) => ({
			set: vi.fn((set: Record<string, unknown>) => ({
				where: vi.fn(async (where: unknown) => {
					state.updates.push({ table, set, where });
				}),
			})),
		})),
	},
}));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FCM_ENV = {
	FCM_PROJECT_ID: "z8-test",
	FCM_CLIENT_EMAIL: "push@z8-test.iam.gserviceaccount.com",
	FCM_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const VAPID_ENV = {
	VAPID_PUBLIC_KEY: "public-key",
	VAPID_PRIVATE_KEY: "private-key",
	VAPID_SUBJECT: "mailto:test@example.com",
};

/** The FCM messages sent, by device token. Tokens named `dead-*` are unregistered. */
const fcmSends: Array<{ token: string; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
	const url = String(input);
	if (url === "https://oauth2.googleapis.com/token") {
		return Response.json({ access_token: "access", expires_in: 3600 });
	}
	const body = JSON.parse(String(init?.body));
	fcmSends.push({ token: body.message.token, body: body.message });
	if (body.message.token.startsWith("dead-")) {
		return Response.json(
			{ error: { code: 404, details: [{ errorCode: "UNREGISTERED" }] } },
			{ status: 404 },
		);
	}
	return Response.json({ name: "projects/z8-test/messages/1" });
});

async function loadPushService(env: Record<string, string | undefined>) {
	for (const key of Object.keys(state.env)) delete state.env[key];
	Object.assign(state.env, env);
	vi.resetModules();
	return import("./push-service");
}

function updatedIds(set: Record<string, unknown>) {
	return state.updates
		.filter((update) => JSON.stringify(update.set) === JSON.stringify(set))
		.flatMap((update) => new PgDialect().sqlToQuery(update.where as SQL).params);
}

const approvalPayload: PushPayload = {
	title: "Anna Schmidt requested vacation",
	body: "Anna Schmidt asks for 2026-10-12 to 2026-10-14",
	tag: "approval_request_submitted",
	data: {
		type: "approval_request_submitted",
		actionUrl: "/approvals/inbox",
		url: "/approvals/inbox",
	},
};

beforeEach(() => {
	state.webSubscriptions = [];
	state.deviceTokens = [];
	state.updates = [];
	fcmSends.length = 0;
	state.webPushSend.mockReset().mockResolvedValue({ statusCode: 201 });
	state.deviceTokenQuery.mockClear();
	fetchMock.mockClear();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Each test re-imports the service under its own env; the first import of the
// module graph is slow when many suites run in parallel.
describe("sendPushToUser", { timeout: 30_000 }, () => {
	it("sends to the user's browser subscriptions and native devices", async () => {
		state.webSubscriptions = [
			{ id: "web-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
		];
		state.deviceTokens = [
			{ id: "device-1", token: "ios-token", platform: "ios" },
			{ id: "device-2", token: "android-token", platform: "android" },
		];
		const push = await loadPushService({ ...VAPID_ENV, ...FCM_ENV });

		const result = await push.sendPushToUser("user-1", approvalPayload, {
			organizationId: "org-1",
		});

		expect(result).toEqual({ sent: 3, failed: 0, expired: [] });
		// Web push keeps its full payload: it is end-to-end encrypted to the browser.
		expect(state.webPushSend).toHaveBeenCalledOnce();
		expect(JSON.parse(state.webPushSend.mock.calls[0][1])).toEqual(approvalPayload);
		// Native push gets one content-free message per device.
		expect(fcmSends.map((send) => send.token)).toEqual(["ios-token", "android-token"]);
		expect(fcmSends[0].body).toMatchObject({
			notification: { title: "You have a request to review" },
			data: {
				type: "approval_request_submitted",
				path: "/approvals/inbox",
				organizationId: "org-1",
			},
		});
		expect(JSON.stringify(fcmSends)).not.toContain("Anna Schmidt");
		// Every delivery records when the subscription or device was last used.
		expect(state.updates.filter((update) => "lastUsedAt" in update.set)).toHaveLength(3);
	});

	it("deactivates a device token FCM reports as invalid and keeps the others", async () => {
		state.deviceTokens = [
			{ id: "device-live", token: "live-token", platform: "android" },
			{ id: "device-dead", token: "dead-token", platform: "ios" },
		];
		const push = await loadPushService({ ...VAPID_ENV, ...FCM_ENV });

		const result = await push.sendPushToUser("user-1", approvalPayload, {
			organizationId: "org-1",
		});

		expect(result).toEqual({ sent: 1, failed: 0, expired: ["device-dead"] });
		expect(updatedIds({ isActive: false })).toEqual(["device-dead"]);
	});

	it("leaves web push exactly as before when FCM is not configured", async () => {
		state.webSubscriptions = [
			{ id: "web-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
		];
		state.deviceTokens = [{ id: "device-1", token: "ios-token", platform: "ios" }];
		const push = await loadPushService(VAPID_ENV);

		const result = await push.sendPushToUser("user-1", approvalPayload, {
			organizationId: "org-1",
		});

		expect(result).toEqual({ sent: 1, failed: 0, expired: [] });
		expect(state.webPushSend).toHaveBeenCalledOnce();
		expect(state.deviceTokenQuery).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(push.isPushAvailable()).toBe(true);
		expect(push.isWebPushAvailable()).toBe(true);
	});

	it("sends native push alone when only FCM is configured", async () => {
		state.webSubscriptions = [
			{ id: "web-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
		];
		state.deviceTokens = [{ id: "device-1", token: "ios-token", platform: "ios" }];
		const push = await loadPushService(FCM_ENV);

		const result = await push.sendPushToUser("user-1", approvalPayload, {
			organizationId: "org-1",
		});

		expect(result).toEqual({ sent: 1, failed: 0, expired: [] });
		expect(state.webPushSend).not.toHaveBeenCalled();
		expect(push.isPushAvailable()).toBe(true);
		expect(push.isWebPushAvailable()).toBe(false);
	});

	it("reports push unavailable when neither channel is configured", async () => {
		const push = await loadPushService({});

		expect(push.isPushAvailable()).toBe(false);
		await expect(push.sendPushToUser("user-1", approvalPayload)).resolves.toEqual({
			sent: 0,
			failed: 0,
			expired: [],
		});
	});
});
