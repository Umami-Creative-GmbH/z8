/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	session: {
		data: {
			user: { id: "operator", role: "admin", banned: false },
			session: { id: "first-session" },
		},
		isPending: false,
	},
	listeners: new Set<(value: unknown) => void>(),
	refresh: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => state.session,
	authClient: {
		$store: {
			atoms: {
				session: {
					subscribe: (listener: (value: unknown) => void) => {
						state.listeners.add(listener);
						return () => state.listeners.delete(listener);
					},
				},
			},
		},
	},
}));

import { OverviewReadFailure, OverviewSnapshot } from "./overview-state";

function overview(
	readId = "first",
	mode: "visible" | "hidden" = "visible",
	sessionId = "first-session",
) {
	return (
		<Activity mode={mode}>
			<OverviewSnapshot userId="operator" sessionId={sessionId} readId={readId}>
				<a href="/platform-admin/users">Platform accounts: 209</a>
			</OverviewSnapshot>
		</Activity>
	);
}

describe("platform overview display lifetime", () => {
	beforeEach(() => {
		state.session = {
			data: {
				user: { id: "operator", role: "admin", banned: false },
				session: { id: "first-session" },
			},
			isPending: false,
		};
		state.listeners.clear();
		state.refresh.mockReset();
	});
	afterEach(cleanup);
	it("hides retained global data during session pending and requires a new completed read", () => {
		const view = render(overview());
		expect(screen.getByRole("link").textContent).toBe("Platform accounts: 209");
		state.session = { ...state.session, isPending: true };
		view.rerender(overview());
		expect(screen.queryByRole("link")).toBeNull();
		state.session = { ...state.session, isPending: false };
		view.rerender(overview());
		expect(screen.queryByRole("link")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(state.refresh).toHaveBeenCalledOnce();
		view.rerender(overview("fresh"));
		expect(screen.getByRole("link")).toBeTruthy();
	});
	it("keeps an unseen read from the old session out of a replacement session for the same operator", () => {
		const view = render(overview());
		state.session = {
			data: { ...state.session.data, session: { id: "replacement-session" } },
			isPending: false,
		};
		view.rerender(overview("late"));
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		view.rerender(overview("fresh", "visible", "replacement-session"));
		expect(screen.getByRole("link").textContent).toBe("Platform accounts: 209");
	});
	it("retires A→B→A atom updates even between renders", () => {
		render(overview());
		act(() => {
			for (const listener of state.listeners) {
				listener({ data: { user: { id: "other", role: "admin" } }, isPending: false });
				listener(state.session);
			}
		});
		expect(screen.queryByRole("link")).toBeNull();
	});
	it("does not treat organization administration as platform authority", () => {
		state.session.data.user.role = "user";
		render(overview());
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Platform overview");
	});
	it("retires a displayed snapshot across Activity hiding", () => {
		const view = render(overview());
		view.rerender(overview("first", "hidden"));
		view.rerender(overview());
		expect(screen.queryByRole("link")).toBeNull();
	});
	it("reports failed data as unavailable with a working Retry", () => {
		render(<OverviewReadFailure>Platform metrics are unavailable.</OverviewReadFailure>);
		expect(screen.getByRole("alert").textContent).toContain("unavailable");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(state.refresh).toHaveBeenCalledOnce();
	});
});
