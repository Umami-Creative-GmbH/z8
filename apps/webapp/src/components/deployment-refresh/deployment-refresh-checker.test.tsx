/* @vitest-environment jsdom */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHECK_COOLDOWN_MS,
	DeploymentRefreshChecker,
} from "./deployment-refresh-checker";
import {
	shouldCheckDeploymentVersion,
	shouldPromptForBuildHash,
} from "./deployment-refresh-checker-utils";

const toastMocks = vi.hoisted(() => ({
	dismiss: vi.fn(),
	show: vi.fn(() => "deployment-update"),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: Object.assign(toastMocks.show, { dismiss: toastMocks.dismiss }),
}));

const originalFetch = globalThis.fetch;
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(
	window,
	"location",
);

function setDocumentHidden(isHidden: boolean) {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		value: isHidden,
	});
}

function mockFetchResponse({
	buildHash,
	ok = true,
}: {
	buildHash: unknown;
	ok?: boolean;
}) {
	const fetchMock = vi.fn().mockResolvedValue({
		json: vi.fn().mockResolvedValue({ buildHash }),
		ok,
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
	const locationDescriptor = Object.getOwnPropertyDescriptor(
		window,
		"location",
	);
	const reloadDescriptor = Object.getOwnPropertyDescriptor(
		window.location,
		"reload",
	);

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

async function dispatchWindowEvent(event: Event) {
	await act(async () => {
		window.dispatchEvent(event);
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function dispatchVisibilityChange() {
	await act(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
		await Promise.resolve();
		await Promise.resolve();
	});
}

function getToastOptions() {
	return toastMocks.show.mock.calls[0]?.[1] as
		| {
				action: { label: string; onClick: () => void };
				cancel: { label: string; onClick: () => void };
				description: string;
				duration: number;
		  }
		| undefined;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000);
	vi.clearAllMocks();
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
	it("returns true for a visible page at exactly the six-hour cooldown", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: CHECK_COOLDOWN_MS,
				isDocumentHidden: false,
				lastCheckStartedAt: 1_000,
				now: 1_000 + CHECK_COOLDOWN_MS,
			}),
		).toBe(true);
	});

	it("returns false for a hidden page even after the cooldown", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: CHECK_COOLDOWN_MS,
				isDocumentHidden: true,
				lastCheckStartedAt: 1_000,
				now: 1_000 + CHECK_COOLDOWN_MS + 1,
			}),
		).toBe(false);
	});

	it("returns false before the cooldown", () => {
		expect(
			shouldCheckDeploymentVersion({
				checkCooldownMs: CHECK_COOLDOWN_MS,
				isDocumentHidden: false,
				lastCheckStartedAt: 1_000,
				now: 1_000 + CHECK_COOLDOWN_MS - 1,
			}),
		).toBe(false);
	});
});

describe("shouldPromptForBuildHash", () => {
	it("returns true for two present differing hashes", () => {
		expect(shouldPromptForBuildHash("client-a", "server-b")).toBe(true);
	});

	it("returns false for matching or missing hashes", () => {
		expect(shouldPromptForBuildHash("client-a", "client-a")).toBe(false);
		expect(shouldPromptForBuildHash("client-a", null)).toBe(false);
		expect(shouldPromptForBuildHash("", "server-b")).toBe(false);
	});
});

describe("DeploymentRefreshChecker", () => {
	it("does not poll on mount or as twelve hours pass without an event", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "server-b" });

		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not fetch for a visibility event while hidden", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "server-b" });
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		setDocumentHidden(true);

		await dispatchVisibilityChange();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fetches once when the page becomes visible after the cooldown", async () => {
		setDocumentHidden(true);
		const fetchMock = mockFetchResponse({ buildHash: "client-a" });
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		setDocumentHidden(false);

		await dispatchVisibilityChange();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("/api/app-version", {
			cache: "no-store",
			headers: { accept: "application/json" },
			signal: expect.any(AbortSignal),
		});
	});

	it("deduplicates simultaneous focus and visibility events and enforces the cooldown", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "client-a" });
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

		await act(async () => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
			await Promise.resolve();
			await Promise.resolve();
		});
		await dispatchWindowEvent(new Event("focus"));

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not fetch without a client build hash", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "server-b" });
		render(<DeploymentRefreshChecker clientBuildHash="" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

		await dispatchWindowEvent(new Event("focus"));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not prompt or reload for a matching hash", async () => {
		mockFetchResponse({ buildHash: "client-a" });
		const reloadMock = mockLocationReload();
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

		await dispatchWindowEvent(new Event("focus"));

		expect(toastMocks.show).not.toHaveBeenCalled();
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it("shows one persistent translated prompt for a differing hash without reloading", async () => {
		mockFetchResponse({ buildHash: "server-b" });
		const reloadMock = mockLocationReload();
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

		await dispatchWindowEvent(new Event("focus"));

		expect(toastMocks.show).toHaveBeenCalledTimes(1);
		expect(toastMocks.show).toHaveBeenCalledWith("Update available", {
			description: "A new version is ready. Reload to update.",
			duration: Infinity,
			action: { label: "Reload", onClick: expect.any(Function) },
			cancel: { label: "Later", onClick: expect.any(Function) },
		});
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it("reloads exactly once when the Reload action is selected", async () => {
		mockFetchResponse({ buildHash: "server-b" });
		const reloadMock = mockLocationReload();
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		getToastOptions()?.action.onClick();

		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it("Later does not reload and prevents future checks or prompts in this mount", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "server-b" });
		const reloadMock = mockLocationReload();
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		getToastOptions()?.cancel.onClick();
		vi.setSystemTime(1_000 + 2 * CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		expect(reloadMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(toastMocks.show).toHaveBeenCalledTimes(1);
	});

	it("does not reset the mounted-session prompt guard when the client hash changes", async () => {
		const fetchMock = mockFetchResponse({ buildHash: "server-b" });
		const { rerender } = render(
			<DeploymentRefreshChecker clientBuildHash="client-a" />,
		);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		rerender(<DeploymentRefreshChecker clientBuildHash="client-c" />);
		vi.setSystemTime(1_000 + 2 * CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(toastMocks.show).toHaveBeenCalledTimes(1);
	});

	it("compares a pending response with the latest client build hash", async () => {
		const pendingResponse = createDeferred<Response>();
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse.promise));
		const { rerender } = render(
			<DeploymentRefreshChecker clientBuildHash="client-a" />,
		);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		rerender(<DeploymentRefreshChecker clientBuildHash="client-b" />);
		await act(async () => {
			pendingResponse.resolve({
				json: vi.fn().mockResolvedValue({ buildHash: "client-b" }),
				ok: true,
			} as unknown as Response);
			await pendingResponse.promise;
			await Promise.resolve();
		});

		expect(toastMocks.show).not.toHaveBeenCalled();
	});

	it("does not overlap requests even after another cooldown elapses", async () => {
		const pendingResponse = createDeferred<Response>();
		const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
		vi.stubGlobal("fetch", fetchMock);
		render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));
		vi.setSystemTime(1_000 + 2 * CHECK_COOLDOWN_MS);

		await dispatchVisibilityChange();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("aborts the active version request on unmount", async () => {
		const pendingResponse = createDeferred<Response>();
		let requestSignal: AbortSignal | null | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
				requestSignal = init?.signal;
				return pendingResponse.promise;
			}),
		);
		const { unmount } = render(
			<DeploymentRefreshChecker clientBuildHash="client-a" />,
		);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		unmount();

		expect(requestSignal?.aborted).toBe(true);
	});

	it("does not show a late prompt after unmount", async () => {
		const pendingResponse = createDeferred<Response>();
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse.promise));
		const { unmount } = render(
			<DeploymentRefreshChecker clientBuildHash="client-a" />,
		);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		unmount();
		await act(async () => {
			pendingResponse.resolve({
				json: vi.fn().mockResolvedValue({ buildHash: "server-b" }),
				ok: true,
			} as unknown as Response);
			await pendingResponse.promise;
			await Promise.resolve();
		});

		expect(toastMocks.show).not.toHaveBeenCalled();
	});

	it.each([null, "", 123])(
		"ignores invalid server build hash %j",
		async (buildHash) => {
			mockFetchResponse({ buildHash });
			const reloadMock = mockLocationReload();
			render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
			vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

			await dispatchWindowEvent(new Event("focus"));

			expect(toastMocks.show).not.toHaveBeenCalled();
			expect(reloadMock).not.toHaveBeenCalled();
		},
	);

	it.each([
		[
			"network rejection",
			() => vi.fn().mockRejectedValue(new Error("offline")),
		],
		[
			"non-2xx response",
			() => vi.fn().mockResolvedValue({ json: vi.fn(), ok: false }),
		],
		[
			"malformed JSON",
			() =>
				vi.fn().mockResolvedValue({
					json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
					ok: true,
				}),
		],
	])(
		"silently ignores %s without allowing an immediate retry",
		async (_name, createFetchMock) => {
			const fetchMock = createFetchMock();
			vi.stubGlobal("fetch", fetchMock);
			render(<DeploymentRefreshChecker clientBuildHash="client-a" />);
			vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);

			await dispatchWindowEvent(new Event("focus"));
			await dispatchVisibilityChange();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(toastMocks.show).not.toHaveBeenCalled();
		},
	);

	it("removes listeners and dismisses a shown toast on unmount", async () => {
		mockFetchResponse({ buildHash: "server-b" });
		const removeWindowListener = vi.spyOn(window, "removeEventListener");
		const removeDocumentListener = vi.spyOn(document, "removeEventListener");
		const { unmount } = render(
			<DeploymentRefreshChecker clientBuildHash="client-a" />,
		);
		vi.setSystemTime(1_000 + CHECK_COOLDOWN_MS);
		await dispatchWindowEvent(new Event("focus"));

		unmount();

		expect(removeWindowListener).toHaveBeenCalledWith(
			"focus",
			expect.any(Function),
		);
		expect(removeDocumentListener).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
		);
		expect(toastMocks.dismiss).toHaveBeenCalledWith("deployment-update");
	});
});
