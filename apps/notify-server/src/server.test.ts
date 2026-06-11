import { describe, expect, it, vi } from "vitest";

import { createNotifyServerHandler } from "./server.js";

describe("createNotifyServerHandler", () => {
	it("serves health", async () => {
		const handler = createNotifyServerHandler({
			validate: vi.fn(),
			getUnreadCount: vi.fn(),
			registerClient: vi.fn(),
		});

		const response = await handler(new Request("http://local/health"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("rejects unauthenticated streams without registering a client", async () => {
		const registerClient = vi.fn();
		const handler = createNotifyServerHandler({
			validate: vi.fn(async () => ({ ok: false, status: 401, message: "Unauthorized" }) as const),
			getUnreadCount: vi.fn(),
			registerClient,
		});

		const response = await handler(new Request("http://local/api/notifications/stream"));

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Unauthorized");
		expect(registerClient).not.toHaveBeenCalled();
	});

	it("sends initial count update for validated organization and registers client", async () => {
		const unregister = vi.fn();
		const registerClient = vi.fn(() => unregister);
		const getUnreadCount = vi.fn(async () => 7);
		const handler = createNotifyServerHandler({
			validate: vi.fn(async () => ({ ok: true, userId: "user-1", organizationId: "org-auth" }) as const),
			getUnreadCount,
			registerClient,
		});

		const response = await handler(
			new Request("http://local/api/notifications/stream?organizationId=org-client"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(getUnreadCount).toHaveBeenCalledWith("user-1", "org-auth");
		expect(registerClient).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user-1", organizationId: "org-auth", send: expect.any(Function) }),
		);

		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const firstChunk = await reader!.read();
		expect(new TextDecoder().decode(firstChunk.value)).toBe(
			'event: count_update\ndata: {"count":7,"organizationId":"org-auth"}\n\n',
		);

		await reader!.cancel();
	});

	it("unregisters the client when the stream is cancelled", async () => {
		const unregister = vi.fn();
		const handler = createNotifyServerHandler({
			validate: vi.fn(async () => ({ ok: true, userId: "user-1", organizationId: "org-auth" }) as const),
			getUnreadCount: vi.fn(async () => 1),
			registerClient: vi.fn(() => unregister),
		});

		const response = await handler(new Request("http://local/api/notifications/stream"));
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel();

		expect(unregister).toHaveBeenCalledTimes(1);
	});
});
