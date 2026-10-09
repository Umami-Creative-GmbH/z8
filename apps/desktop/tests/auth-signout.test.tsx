import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const native = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: async (name: string, handler: () => void) => {
		native.listeners.set(name, handler);
		return () => native.listeners.delete(name);
	},
}));
import { useAuth } from "../src/hooks/useAuth";
function View() {
	const auth = useAuth();
	return auth.isAuthenticated ? (
		<>
			<p>Company clock</p>
			<button onClick={() => void auth.logout().catch(() => {})}>
				Sign out
			</button>
		</>
	) : (
		<p>Sign in with Z8</p>
	);
}
let client: QueryClient;
beforeEach(() => {
	native.invoke.mockReset();
	native.listeners.clear();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(["session"], {
		isAuthenticated: true,
		credentialError: null,
		sessionRevision: 3,
	});
	for (const key of [
		"organizations",
		"desktop-context",
		"clock-status",
		"clock-journal",
	])
		client.setQueryData([key, "old-session"], { private: "old tenant" });
	client.setQueryData(["settings"], { language: "de" });
});
afterEach(() => {
	cleanup();
	client.clear();
});
it("shows sign-in immediately after native logout even if session refresh never resolves", async () => {
	native.invoke.mockImplementation((command: string) =>
		command === "logout" ? Promise.resolve() : new Promise(() => {}),
	);
	render(
		<QueryClientProvider client={client}>
			<View />
		</QueryClientProvider>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
	await waitFor(() => expect(screen.queryByText("Company clock")).toBeNull());
	expect(screen.getByText("Sign in with Z8")).toBeDefined();
	for (const key of [
		"organizations",
		"desktop-context",
		"clock-status",
		"clock-journal",
	])
		expect(client.getQueriesData({ queryKey: [key] })).toEqual([]);
	expect(client.getQueryData(["settings"])).toEqual({ language: "de" });
});
it("does not let an old pending session read restore the signed-out UI", async () => {
	let resolveSession: (value: unknown) => void = () => {};
	native.invoke.mockImplementation((command: string) =>
		command === "logout"
			? Promise.resolve()
			: new Promise((resolve) => {
					resolveSession = resolve;
				}),
	);
	render(
		<QueryClientProvider client={client}>
			<View />
		</QueryClientProvider>,
	);
	void client.invalidateQueries({ queryKey: ["session"] });
	await waitFor(() =>
		expect(native.invoke).toHaveBeenCalledWith("get_session"),
	);
	await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
	await act(async () =>
		resolveSession({
			isAuthenticated: true,
			credentialError: null,
			sessionRevision: 3,
		}),
	);
	expect(screen.queryByText("Company clock")).toBeNull();
	expect(screen.getByText("Sign in with Z8")).toBeDefined();
});
it("handles native sign-out events, including expired credentials", async () => {
	native.invoke.mockImplementation(() => new Promise(() => {}));
	render(
		<QueryClientProvider client={client}>
			<View />
		</QueryClientProvider>,
	);
	await waitFor(() => expect(native.listeners.has("logout")).toBe(true));
	act(() => native.listeners.get("logout")?.());
	await waitFor(() =>
		expect(screen.getByText("Sign in with Z8")).toBeDefined(),
	);
	expect(client.getQueriesData({ queryKey: ["desktop-context"] })).toEqual([]);
});
