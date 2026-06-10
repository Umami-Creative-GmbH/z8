/* @vitest-environment jsdom */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHECK_INTERVAL_MS,
	DeploymentRefreshChecker,
	shouldCheckDeploymentVersion,
	shouldReloadForBuildHash,
} from "./deployment-refresh-checker";

const originalFetch = globalThis.fetch;
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location");

function setDocumentHidden(isHidden: boolean) {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		value: isHidden,
	});
}

function mockFetchBuildHash(buildHash: unknown) {
	const fetchMock = vi.fn().mockResolvedValue({
		json: vi.fn().mockResolvedValue({ buildHash }),
		ok: true,
	});

	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, reject, resolve };
}

function mockLocationReload() {
	const reloadMock = vi.fn();
	const originalLocation = window.location;
	const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
	const reloadDescriptor = Object.getOwnPropertyDescriptor(window.location, "reload");

	if (reloadDescriptor?.configurable) {
		Object.defineProperty(window.location, "reload", {
			configurable: true,
			value: reloadMock,
		});

		return reloadMock;
	}

	if (locationDescriptor?.configurable) {
		Object.defineProperty(window, "location", {
			configurable: true,
			value: {
				...originalLocation,
				reload: reloadMock,
			},
		});

		return reloadMock;
	}

	return vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	setDocumentHidden(false);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalLocationDescriptor?.configurable) {
		Object.defineProperty(window, "location", originalLocationDescriptor);
	}
	setDocumentHidden(false);
	globalThis.fetch = originalFetch;
});

describe("shouldCheckDeploymentVersion", () => {
	it("allows checks when the document is hidden", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: true,
				lastActivityAt: 1_000,
				now: 1_001,
			}),
		).toBe(true);
	});

	it("allows checks when the visible document is idle", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 301_000,
			}),
		).toBe(true);
	});

	it("skips checks when the visible document was recently active", () => {
		expect(
			shouldCheckDeploymentVersion({
				idleThresholdMs: 300_000,
				isDocumentHidden: false,
				lastActivityAt: 1_000,
				now: 299_999,
			}),
		).toBe(false);
	});
});

describe("shouldReloadForBuildHash", () => {
	it("reloads when both hashes exist and differ", () => {
		expect(shouldReloadForBuildHash("client-a", "server-b")).toBe(true);
	});

	it("does not reload when hashes match", () => {
		expect(shouldReloadForBuildHash("client-a", "client-a")).toBe(false);
	});

	it("does not reload when a hash is missing", () => {
		expect(shouldReloadForBuildHash("client-a", null)).toBe(false);
		expect(shouldReloadForBuildHash("", "server-b")).toBe(false);
	});
});

describe("DeploymentRefreshChecker", () => {
	it("does not fetch while a visible page is active after an activity event", async () => {
		const fetchMock = mockFetchBuildHash("server-b");

		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
			window.dispatchEvent(new KeyboardEvent("keydown"));
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1_000);
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reloads once when a hidden page sees a different build hash across two intervals", async () => {
		setDocumentHidden(true);
		const fetchMock = mockFetchBuildHash("server-b");
		const reloadMock = mockLocationReload();

		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("/api/app-version", {
			cache: "no-store",
			headers: { accept: "application/json" },
		});
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it("does not reload when the server hash matches", async () => {
		setDocumentHidden(true);
		mockFetchBuildHash("client-a");
		const reloadMock = mockLocationReload();

		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		});

		expect(reloadMock).not.toHaveBeenCalled();
	});

	it("does not start another fetch on the next interval while a check is in flight", async () => {
		setDocumentHidden(true);
		const pendingResponse = createDeferred<Response>();
		const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
		vi.stubGlobal("fetch", fetchMock);

		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not reload after unmount when a pending version response resolves", async () => {
		setDocumentHidden(true);
		const pendingResponse = createDeferred<Response>();
		const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
		vi.stubGlobal("fetch", fetchMock);
		const reloadMock = mockLocationReload();

		const { unmount } = render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		});

		unmount();

		await act(async () => {
			pendingResponse.resolve({
				json: vi.fn().mockResolvedValue({ buildHash: "server-b" }),
				ok: true,
			} as unknown as Response);
			await pendingResponse.promise;
		});

		expect(reloadMock).not.toHaveBeenCalled();
	});
});
