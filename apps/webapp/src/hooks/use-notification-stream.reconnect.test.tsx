/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useNotificationStream } from "./use-notification-stream";

class MockEventSource {
	static instances: MockEventSource[] = [];
	onerror: (() => void) | null = null;
	onopen: (() => void) | null = null;
	closed = false;

	constructor(readonly url: string) {
		MockEventSource.instances.push(this);
	}

	addEventListener() {}

	close() {
		this.closed = true;
	}
}

function wrapper(client: QueryClient) {
	return function TestWrapper({ children }: { children: React.ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	};
}

describe("useNotificationStream connection lifecycle", () => {
	const originalEventSource = globalThis.EventSource;

	beforeEach(() => {
		MockEventSource.instances = [];
		Object.defineProperty(globalThis, "EventSource", {
			configurable: true,
			value: MockEventSource,
		});
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "EventSource", {
			configurable: true,
			value: originalEventSource,
		});
	});

	it("does not reconnect when opening the stream updates hook state", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		renderHook(() => useNotificationStream({ enabled: true, organizationId: "org-a" }), {
			wrapper: wrapper(client),
		});

		expect(MockEventSource.instances).toHaveLength(1);

		act(() => {
			MockEventSource.instances[0].onopen?.();
		});

		await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		expect(MockEventSource.instances[0].closed).toBe(false);
	});
});
