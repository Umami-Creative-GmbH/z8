import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createNativePushClient,
	isNativePushPromptMoment,
	type NativePushPlugin,
	type NativePushStorage,
	nativePushTapTarget,
} from "./native-push";

type Permission = "prompt" | "granted" | "denied";

function fakePlugin(options: {
	permission?: Permission;
	grantOnRequest?: boolean;
	token?: string;
}) {
	let permission: Permission = options.permission ?? "prompt";
	let token = options.token ?? "token-1";
	const plugin = {
		checkPermissions: vi.fn(async () => ({ receive: permission })),
		requestPermissions: vi.fn(async () => {
			if (permission === "prompt") permission = options.grantOnRequest ? "granted" : "denied";
			return { receive: permission };
		}),
		getToken: vi.fn(async () => ({ token })),
		deleteToken: vi.fn(async () => undefined),
		addListener: vi.fn(async () => ({ remove: async () => undefined })),
	} satisfies NativePushPlugin;
	return {
		plugin,
		rotateToken(next: string) {
			token = next;
		},
	};
}

function memoryStorage(initial: Record<string, string> = {}): NativePushStorage & {
	values: Record<string, string>;
} {
	const values = { ...initial };
	return {
		values,
		get: (key) => values[key] ?? null,
		set: (key, value) => {
			values[key] = value;
		},
		remove: (key) => {
			delete values[key];
		},
	};
}

/** A fake web app API; records device-token calls as "METHOD body". */
function fakeApi(options: { available?: boolean; saveStatus?: number } = {}) {
	const calls: string[] = [];
	const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		if (method === "GET") return Response.json({ available: options.available ?? true });
		calls.push(`${method} ${init?.body}`);
		return new Response(null, { status: method === "POST" ? (options.saveStatus ?? 200) : 200 });
	});
	return { calls, fetch };
}

const STORED = "z8.nativePush.token";

describe("native push client", () => {
	let storage: ReturnType<typeof memoryStorage>;

	beforeEach(() => {
		storage = memoryStorage();
	});

	it("asks for permission only when the user turns push on, then saves the device token", async () => {
		const { plugin } = fakePlugin({ grantOnRequest: true });
		const api = fakeApi();
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });

		expect(await client.loadState()).toEqual({
			available: true,
			permission: "default",
			subscribed: false,
		});
		expect(plugin.requestPermissions).not.toHaveBeenCalled();

		await expect(client.subscribe()).resolves.toBe(true);

		expect(plugin.requestPermissions).toHaveBeenCalledOnce();
		expect(api.calls).toEqual([`POST {"token":"token-1","platform":"ios"}`]);
		expect(storage.values[STORED]).toBe("token-1");
		expect(await client.loadState()).toMatchObject({ permission: "granted", subscribed: true });
	});

	it("saves nothing when the user denies permission", async () => {
		const { plugin } = fakePlugin({ grantOnRequest: false });
		const api = fakeApi();
		const client = createNativePushClient({
			plugin,
			platform: "android",
			fetch: api.fetch,
			storage,
		});

		await expect(client.subscribe()).resolves.toBe(false);

		expect(plugin.getToken).not.toHaveBeenCalled();
		expect(api.calls).toEqual([]);
		expect(storage.values[STORED]).toBeUndefined();
	});

	it("drops the native token again when the server refuses to save it", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		const api = fakeApi({ saveStatus: 503 });
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });

		await expect(client.subscribe()).resolves.toBe(false);

		expect(plugin.deleteToken).toHaveBeenCalledOnce();
		expect(storage.values[STORED]).toBeUndefined();
	});

	it("reports native push unavailable while the server has no FCM credentials", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		const api = fakeApi({ available: false });
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });

		expect(await client.loadState()).toMatchObject({ available: false });
		await client.refresh();
		expect(plugin.getToken).not.toHaveBeenCalled();
	});

	it("re-registers on app start only for a device that turned push on", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		const api = fakeApi();
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });

		await client.refresh();
		expect(plugin.getToken).not.toHaveBeenCalled();
		expect(plugin.requestPermissions).not.toHaveBeenCalled();

		storage.set(STORED, "token-1");
		await client.refresh();
		expect(api.calls).toEqual([`POST {"token":"token-1","platform":"ios"}`]);
	});

	it("replaces a rotated token and removes the old one", async () => {
		const fake = fakePlugin({ permission: "granted", token: "token-2" });
		const api = fakeApi();
		storage.set(STORED, "token-1");
		const client = createNativePushClient({
			plugin: fake.plugin,
			platform: "android",
			fetch: api.fetch,
			storage,
		});

		await client.refresh();

		expect(api.calls).toEqual([
			`POST {"token":"token-2","platform":"android"}`,
			`DELETE {"token":"token-1"}`,
		]);
		expect(storage.values[STORED]).toBe("token-2");

		await client.replaceToken("token-3");
		expect(api.calls.slice(2)).toEqual([
			`POST {"token":"token-3","platform":"android"}`,
			`DELETE {"token":"token-2"}`,
		]);
	});

	it("stops pushes to the device when the user turns push off", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		const api = fakeApi();
		storage.set(STORED, "token-1");
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });

		await expect(client.unsubscribe()).resolves.toBe(true);

		expect(api.calls).toEqual([`DELETE {"token":"token-1"}`]);
		expect(plugin.deleteToken).toHaveBeenCalledOnce();
		expect(storage.values[STORED]).toBeUndefined();
	});

	it("hands a tapped notification's data to the app and saves rotated tokens", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		const api = fakeApi();
		storage.set(STORED, "token-1");
		const listeners = new Map<string, (event: never) => void>();
		const removed: string[] = [];
		plugin.addListener.mockImplementation(async (eventName: string, listener: never) => {
			listeners.set(eventName, listener);
			return { remove: async () => void removed.push(eventName) };
		});
		const client = createNativePushClient({ plugin, platform: "ios", fetch: api.fetch, storage });
		const onTap = vi.fn();

		const stop = await client.listen(onTap);
		listeners.get("notificationActionPerformed")?.({
			actionId: "tap",
			notification: { data: { path: "/approvals/inbox", organizationId: "org-1" } },
		} as never);
		listeners.get("tokenReceived")?.({ token: "token-2" } as never);
		await vi.waitFor(() => expect(storage.values[STORED]).toBe("token-2"));

		expect(onTap).toHaveBeenCalledWith({ path: "/approvals/inbox", organizationId: "org-1" });
		expect(api.calls).toEqual([
			`POST {"token":"token-2","platform":"ios"}`,
			`DELETE {"token":"token-1"}`,
		]);

		await stop();
		expect(removed.sort()).toEqual(["notificationActionPerformed", "tokenReceived"]);
	});

	it("removes the device token before sign-out and swallows failures", async () => {
		const { plugin } = fakePlugin({ permission: "granted" });
		storage.set(STORED, "token-1");
		const failing = vi.fn(async () => {
			throw new Error("offline");
		});
		const client = createNativePushClient({ plugin, platform: "ios", fetch: failing, storage });

		await expect(client.removeForSignOut()).resolves.toBeUndefined();
		expect(failing).toHaveBeenCalledWith(
			"/api/notifications/push/native-token",
			expect.objectContaining({ method: "DELETE" }),
		);
		expect(plugin.deleteToken).toHaveBeenCalledOnce();
		expect(storage.values[STORED]).toBeUndefined();
	});
});

describe("isNativePushPromptMoment", () => {
	it("offers push on pages whose news arrives by push, not on the start page", () => {
		expect(isNativePushPromptMoment("/")).toBe(false);
		expect(isNativePushPromptMoment("/today")).toBe(false);
		expect(isNativePushPromptMoment("/settings/profile")).toBe(false);
		expect(isNativePushPromptMoment("/approvals/inbox")).toBe(true);
		expect(isNativePushPromptMoment("/absences")).toBe(true);
		expect(isNativePushPromptMoment("/my-requests")).toBe(true);
		expect(isNativePushPromptMoment("/scheduling")).toBe(true);
		expect(isNativePushPromptMoment("/travel-expenses/reports/r-1")).toBe(true);
		expect(isNativePushPromptMoment("/absences-archive")).toBe(false);
	});
});

describe("nativePushTapTarget", () => {
	it("switches to the notification's organization through the organization switch first", () => {
		expect(
			nativePushTapTarget({ path: "/approvals/inbox", organizationId: "org-2" }, "org-1"),
		).toBe("/init?organizationId=org-2&callbackUrl=%2Fapprovals%2Finbox");
	});

	it("opens the path directly when the organization is already active", () => {
		expect(
			nativePushTapTarget({ path: "/approvals/inbox", organizationId: "org-1" }, "org-1"),
		).toBe("/approvals/inbox");
	});

	it("goes through the switch when the active organization is unknown", () => {
		expect(nativePushTapTarget({ path: "/absences", organizationId: "org-1" }, null)).toBe(
			"/init?organizationId=org-1&callbackUrl=%2Fabsences",
		);
	});

	it("opens a push without organization as is, and only same-origin paths", () => {
		expect(nativePushTapTarget({ path: "/" }, "org-1")).toBe("/");
		expect(nativePushTapTarget({ path: "https://evil.example/" }, "org-1")).toBe("/");
		expect(nativePushTapTarget({ path: "//evil.example/" }, "org-1")).toBe("/");
		expect(nativePushTapTarget(undefined, "org-1")).toBe("/");
		expect(nativePushTapTarget({ path: 42, organizationId: { id: 1 } }, "org-1")).toBe("/");
	});
});
