import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationWithMeta } from "@/lib/notifications/types";

const setQueriesDataMock = vi.fn();
const setQueryDataMock = vi.fn();

class MockEventSource {
	static latest: MockEventSource | undefined;
	listeners = new Map<string, (event: MessageEvent) => void>();
	onerror: (() => void) | null = null;
	onopen: (() => void) | null = null;

	constructor(_url: string) {
		MockEventSource.latest = this;
	}

	addEventListener(type: string, listener: (event: MessageEvent) => void) {
		this.listeners.set(type, listener);
	}

	close() {}
}

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueriesData: setQueriesDataMock,
		setQueryData: setQueryDataMock,
	}),
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => undefined | (() => void)) => effect(),
	useRef: (initialValue: unknown) => ({ current: initialValue }),
	useState: (initialValue: unknown) => [initialValue, vi.fn()],
}));

describe("useNotificationStream", () => {
	const originalWindow = globalThis.window;
	const originalEventSource = globalThis.EventSource;

	beforeEach(() => {
		setQueriesDataMock.mockReset();
		setQueryDataMock.mockReset();
		MockEventSource.latest = undefined;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {},
		});
		Object.defineProperty(globalThis, "EventSource", {
			configurable: true,
			value: MockEventSource,
		});
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: originalWindow,
		});
		Object.defineProperty(globalThis, "EventSource", {
			configurable: true,
			value: originalEventSource,
		});
	});

	it("prepends new notifications to every cached notification list", async () => {
		const { useNotificationStream } = await import("./use-notification-stream");
		const notification = {
			id: "notification-1",
			isRead: false,
			title: "New approval",
		} as NotificationWithMeta;

		useNotificationStream();
		MockEventSource.latest?.listeners.get("new_notification")?.(
			new MessageEvent("new_notification", { data: JSON.stringify(notification) }),
		);

		expect(setQueriesDataMock).toHaveBeenCalledWith(
			expect.objectContaining({ predicate: expect.any(Function) }),
			expect.any(Function),
		);

		const filters = setQueriesDataMock.mock.calls[0][0];
		expect(filters.predicate({ queryKey: ["notifications", "list", { limit: 20 }] })).toBe(true);
		expect(filters.predicate({ queryKey: ["notifications", "unread-count"] })).toBe(false);

		const updateList = setQueriesDataMock.mock.calls[0][1];
		expect(updateList({ notifications: [], total: 0, unreadCount: 0, hasMore: false })).toEqual(
			expect.objectContaining({
				notifications: [notification],
				total: 1,
				unreadCount: 1,
			}),
		);
	});
});
