/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TolgeeNextProvider } from "./client";

const mockState = vi.hoisted(() => {
	const refresh = vi.fn();
	const listeners = new Set<() => void>();
	const instance = {
		addActiveNs: vi.fn(async () => undefined),
		addStaticData: vi.fn(() => {
			for (const listener of listeners) {
				listener();
			}
		}),
		on: vi.fn((_event: string, listener: () => void) => {
			listeners.add(listener);
			return { unsubscribe: () => listeners.delete(listener) };
		}),
	};

	return {
		instance,
		listeners,
		refresh,
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockState.refresh }),
}));

vi.mock("@tolgee/react", () => ({
	TolgeeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useTolgee: () => mockState.instance,
}));

vi.mock("./shared", () => ({
	TolgeeBase: () => ({
		init: vi.fn(() => mockState.instance),
	}),
}));

beforeEach(() => {
	mockState.refresh.mockClear();
	mockState.instance.addActiveNs.mockClear();
	mockState.instance.addStaticData.mockClear();
	mockState.instance.on.mockClear();
	mockState.listeners.clear();
});

describe("TolgeeNextProvider", () => {
	it("does not refresh the router when route static data changes", () => {
		const { rerender } = render(
			<TolgeeNextProvider language="en" staticData={{ en: { dashboard: { title: "Dashboard" } } }}>
				<div>Dashboard</div>
			</TolgeeNextProvider>,
		);

		rerender(
			<TolgeeNextProvider language="en" staticData={{ en: { settings: { title: "Settings" } } }}>
				<div>Settings</div>
			</TolgeeNextProvider>,
		);

		expect(mockState.refresh).not.toHaveBeenCalled();
	});
});
