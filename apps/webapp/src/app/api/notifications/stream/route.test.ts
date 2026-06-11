import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn(async () => [{ organizationId: "org-active" }]);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const subscriber = {
		disconnect: vi.fn(),
		on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
			mockState.subscriberListeners.set(event, callback);
		}),
		subscribe: vi.fn(async () => undefined),
		unsubscribe: vi.fn(async () => undefined),
	};

	return {
		connection: vi.fn(),
		createRedisSubscriber: vi.fn(() => subscriber),
		getSession: vi.fn(),
		getUnreadCount: vi.fn(),
		headers: vi.fn(),
		limit,
		select,
		subscriber,
		subscriberListeners: new Map<string, (...args: unknown[]) => void>(),
		redis: { status: "ready" },
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		isActive: "employee.isActive",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

vi.mock("@/lib/notifications/notification-service", () => ({
	getUnreadCount: mockState.getUnreadCount,
}));

vi.mock("@/lib/redis", () => ({
	createRedisSubscriber: mockState.createRedisSubscriber,
	redis: mockState.redis,
}));

const { GET } = await import("./route");

function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const decoder = new TextDecoder();
	return reader.read().then(({ value }) => decoder.decode(value));
}

describe("GET /api/notifications/stream", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		mockState.subscriberListeners.clear();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-active" },
			user: { id: "user-1" },
		});
		mockState.getUnreadCount.mockResolvedValue(3);
		mockState.limit.mockResolvedValue([{ organizationId: "org-active" }]);
		mockState.redis.status = "ready";
	});

	it("scopes the initial count update to the active organization", async () => {
		const response = await GET();
		const reader = response.body?.getReader();

		expect(reader).toBeDefined();
		await expect(readEvent(reader as ReadableStreamDefaultReader<Uint8Array>)).resolves.toContain(
			'data: {"count":3,"organizationId":"org-active"}',
		);
		await reader?.cancel();
	});

	it("forwards only organization-scoped Redis notification events", async () => {
		const response = await GET();
		const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		await readEvent(reader);

		const onMessage = mockState.subscriberListeners.get("message");
		expect(onMessage).toBeDefined();

		onMessage?.(
			"notifications:user-1",
			JSON.stringify({
				data: { count: 8, organizationId: "other-org" },
				event: "count_update",
			}),
		);
		onMessage?.(
			"notifications:user-1",
			JSON.stringify({ data: { count: 9 }, event: "count_update" }),
		);
		onMessage?.(
			"notifications:user-1",
			JSON.stringify({ data: { organizationId: "other-org" }, event: "new_notification" }),
		);
		onMessage?.(
			"notifications:user-1",
			JSON.stringify({ data: { timestamp: 1 }, event: "heartbeat" }),
		);
		onMessage?.(
			"notifications:user-1",
			JSON.stringify({
				data: { count: 4, organizationId: "org-active" },
				event: "count_update",
			}),
		);

		await expect(readEvent(reader)).resolves.toContain(
			'data: {"count":4,"organizationId":"org-active"}',
		);
		await reader.cancel();
	});

	it("cleans up Redis subscriptions when the stream is cancelled", async () => {
		const response = await GET();
		const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		await readEvent(reader);

		await reader.cancel();

		expect(mockState.subscriber.unsubscribe).toHaveBeenCalledWith("notifications:user-1");
		expect(mockState.subscriber.disconnect).toHaveBeenCalled();
	});

	it("scopes polling fallback count updates to the active organization", async () => {
		vi.useFakeTimers();
		mockState.redis.status = "end";
		mockState.getUnreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(5);

		const response = await GET();
		const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		await readEvent(reader);

		const nextEvent = readEvent(reader);
		await vi.advanceTimersByTimeAsync(5000);

		await expect(nextEvent).resolves.toContain('data: {"count":5,"organizationId":"org-active"}');
		await reader.cancel();
		vi.useRealTimers();
	});
});
