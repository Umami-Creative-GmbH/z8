/* @vitest-environment jsdom */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({
	NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
	NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
}));
vi.mock("@/env", () => ({ env: environment }));
function deferred() {
	let resolve = () => {};
	let reject = (_error: Error) => {};
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const sdk = {
	init: vi.fn(),
	opt_in_capturing: vi.fn(),
	opt_out_capturing: vi.fn(),
	reset: vi.fn(),
};
let gate: ReturnType<typeof deferred>;
let loads = 0;
async function provider() {
	return (await import("./posthog-provider")).PostHogProvider;
}
function App() {
	return (
		<>
			<input aria-label="Work note" />
			<button type="button">Clock Out</button>
			<a href="/en">Dashboard</a>
		</>
	);
}

describe("lazy analytics transport", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		loads = 0;
		environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
		gate = deferred();
		vi.doMock("posthog-js", async () => {
			loads += 1;
			await gate.promise;
			return {
				default: {
					init: (...args: unknown[]) => sdk.init(...args),
					opt_in_capturing: () => sdk.opt_in_capturing(),
					opt_out_capturing: () => sdk.opt_out_capturing(),
					reset: () => sdk.reset(),
				},
			};
		});
	});
	afterEach(cleanup);
	it.each([
		{ disabled: false, helpImproveProduct: false, token: "phc_test" },
		{ disabled: true, helpImproveProduct: true, token: "phc_test" },
		{ disabled: false, helpImproveProduct: true, token: "  " },
	])(
		"does not request the SDK when deployment or consent disallows it (%j)",
		async ({ token, ...props }) => {
			environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = token;
			const Provider = await provider();
			render(
				<Provider identityKey="user-1:org-1" {...props}>
					<App />
				</Provider>,
			);
			await act(async () => {});
			expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
			expect(loads).toBe(0);
			expect(sdk.init).not.toHaveBeenCalled();
		},
	);
	it("keeps the app interactive while the actual SDK import is pending, then initializes once", async () => {
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "Keep my draft" } });
		await act(async () => {});
		expect(loads).toBe(1);
		expect(sdk.init).not.toHaveBeenCalled();
		await act(async () => gate.resolve());
		expect(screen.getByRole("textbox")).toBe(input);
		expect(screen.getByDisplayValue("Keep my draft")).toBe(input);
		expect(sdk.init).toHaveBeenCalledOnce();
		expect(sdk.init).toHaveBeenCalledWith(
			"phc_test",
			expect.objectContaining({
				api_host: "/ingest",
				capture_pageview: "history_change",
			}),
		);
		expect(sdk.opt_in_capturing).toHaveBeenCalledOnce();
		view.rerender(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		expect(sdk.init).toHaveBeenCalledOnce();
	});
	it("resets the previous analytics identity without losing app state when the actor changes", async () => {
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => gate.resolve());
		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "Current draft" } });
		await act(async () =>
			view.rerender(
				<Provider
					identityKey="user-2:org-2"
					disabled={false}
					helpImproveProduct
				>
					<App />
				</Provider>,
			),
		);
		expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
		expect(sdk.reset).toHaveBeenCalledOnce();
		expect(sdk.init).toHaveBeenCalledTimes(2);
		expect(screen.getByDisplayValue("Current draft")).toBe(input);
	});
	it.each(["consent", "deployment", "configuration", "unmount"])(
		"does not initialize a late import after %s is withdrawn",
		async (reason) => {
			const Provider = await provider();
			const view = render(
				<Provider
					identityKey="user-1:org-1"
					disabled={false}
					helpImproveProduct
				>
					<App />
				</Provider>,
			);
			await act(async () => {});
			expect(loads).toBe(1);
			if (reason === "unmount") view.unmount();
			else {
				if (reason === "configuration")
					environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "";
				view.rerender(
					<Provider
						identityKey="user-1:org-1"
						disabled={reason === "deployment"}
						helpImproveProduct={reason !== "consent"}
					>
						<App />
					</Provider>,
				);
			}
			await act(async () => gate.resolve());
			expect(sdk.init).not.toHaveBeenCalled();
			expect(sdk.opt_in_capturing).not.toHaveBeenCalled();
			expect(sdk.reset).not.toHaveBeenCalled();
			if (reason !== "unmount")
				expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
		},
	);
	it("only initializes the current actor when identity changes during the SDK download", async () => {
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => {});
		view.rerender(
			<Provider identityKey="user-2:org-2" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => gate.resolve());
		expect(sdk.init).toHaveBeenCalledOnce();
		expect(sdk.opt_in_capturing).toHaveBeenCalledOnce();
	});
	it("leaves clock, navigation and the focused draft usable after an import rejection", async () => {
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		const input = screen.getByRole("textbox");
		input.focus();
		fireEvent.change(input, { target: { value: "Retained after failure" } });
		await act(async () => gate.reject(new Error("Synthetic offline chunk")));
		expect(screen.getByDisplayValue("Retained after failure")).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
		expect(screen.getByRole("link").getAttribute("href")).toBe("/en");
		view.rerender(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		expect(loads).toBe(1);
		expect(sdk.init).not.toHaveBeenCalled();
	});
	it.each(["consent", "deployment", "configuration", "unmount"])(
		"opts out and resets a loaded SDK on %s withdrawal without remounting the app",
		async (reason) => {
			const Provider = await provider();
			const view = render(
				<Provider
					identityKey="user-1:org-1"
					disabled={false}
					helpImproveProduct
				>
					<App />
				</Provider>,
			);
			await act(async () => gate.resolve());
			const input = screen.getByRole("textbox");
			fireEvent.change(input, { target: { value: "Draft before withdrawal" } });
			if (reason === "unmount") view.unmount();
			else {
				if (reason === "configuration")
					environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "";
				view.rerender(
					<Provider
						identityKey="user-1:org-1"
						disabled={reason === "deployment"}
						helpImproveProduct={reason !== "consent"}
					>
						<App />
					</Provider>,
				);
				expect(screen.getByDisplayValue("Draft before withdrawal")).toBe(input);
			}
			expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
			expect(sdk.reset).toHaveBeenCalledOnce();
			expect(sdk.init).toHaveBeenCalledOnce();
		},
	);
	it("cleans up partial initialization without leaking an SDK exception or retrying every render", async () => {
		sdk.init.mockImplementationOnce(() => {
			throw new Error("Synthetic SDK initialization error");
		});
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => gate.resolve());
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
		expect(sdk.opt_in_capturing).not.toHaveBeenCalled();
		expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
		expect(sdk.reset).toHaveBeenCalledOnce();
		view.rerender(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		expect(sdk.init).toHaveBeenCalledOnce();
		view.unmount();
		expect(sdk.reset).toHaveBeenCalledOnce();
	});
	it("does not let optional SDK cleanup failures break consent withdrawal", async () => {
		const Provider = await provider();
		const view = render(
			<Provider identityKey="user-1:org-1" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => gate.resolve());
		sdk.opt_out_capturing.mockImplementationOnce(() => {
			throw new Error("Synthetic SDK opt out error");
		});
		sdk.reset.mockImplementationOnce(() => {
			throw new Error("Synthetic SDK reset error");
		});
		view.rerender(
			<Provider
				identityKey="user-1:org-1"
				disabled={false}
				helpImproveProduct={false}
			>
				<App />
			</Provider>,
		);
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
		expect(sdk.reset).toHaveBeenCalledOnce();
	});
	it("initializes once after Strict Mode replays the pending effect", async () => {
		const Provider = await provider();
		render(
			<StrictMode>
				<Provider
					identityKey="user-1:org-1"
					disabled={false}
					helpImproveProduct
				>
					<App />
				</Provider>
			</StrictMode>,
		);
		await act(async () => gate.resolve());
		expect(loads).toBe(1);
		await waitFor(() => expect(sdk.init).toHaveBeenCalledOnce());
		expect(sdk.opt_in_capturing).toHaveBeenCalledOnce();
	});
	it("does not load analytics without a known authenticated identity", async () => {
		const Provider = await provider();
		render(
			<Provider identityKey="" disabled={false} helpImproveProduct>
				<App />
			</Provider>,
		);
		await act(async () => {});
		expect(loads).toBe(0);
		expect(sdk.init).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
	});
});
