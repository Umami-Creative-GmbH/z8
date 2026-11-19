/* @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
	complete: vi.fn(),
	summary: vi.fn(),
	session: {
		data: {
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
		} as { user: { id: string }; session: { activeOrganizationId: string } } | null,
		isPending: false,
	},
	t: (_key: string, fallback?: string) => fallback ?? _key,
}));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: boundary.t }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => boundary.session }));
vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
		<a href={href} {...props} />
	),
	useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./actions", () => ({
	completeOnboarding: boundary.complete,
	getOnboardingSummary: boundary.summary,
}));

import CompletePage from "./page";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const summary = (overrides = {}) => ({
	success: true,
	data: {
		hasOrganization: true,
		organizationName: "Acme",
		profileCompleted: true,
		workPolicySet: false,
		isAdmin: true,
		holidayPresetCreated: false,
		notificationsConfigured: false,
		wellnessConfigured: true,
		...overrides,
	},
});
describe("personal onboarding completion", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		boundary.session = {
			data: {
				user: { id: "actor-a" },
				session: { activeOrganizationId: "org-a" },
			},
			isPending: false,
		};
		boundary.complete.mockResolvedValue({ success: true });
		boundary.summary.mockResolvedValue(summary());
	});
	it("does not claim success or allow continuation after failed finalization, and retries once", async () => {
		boundary.complete.mockResolvedValueOnce({
			success: false,
			error: "internal failure",
		});
		render(
			<StrictMode>
				<CompletePage />
			</StrictMode>,
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByText("You're all set!")).toBeNull();
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		expect(screen.queryByText("internal failure")).toBeNull();
		expect(boundary.summary).not.toHaveBeenCalled();
		const retry = screen.getByRole("button", { name: "Retry completion" });
		fireEvent.click(retry);
		fireEvent.click(retry);
		expect(await screen.findByRole("link", { name: "Continue to workspace" })).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledTimes(2);
	});
	it("separates summary failure from confirmed completion and retries only the read", async () => {
		boundary.summary.mockRejectedValueOnce(new Error("private summary internals"));
		render(<CompletePage />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Personal setup complete" })).toBeTruthy();
		expect(screen.queryByText("private summary internals")).toBeNull();
		expect(screen.getByRole("link", { name: "Continue to workspace" }).getAttribute("href")).toBe(
			"/init",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry summary" }));
		expect(await screen.findByText("Acme")).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledOnce();
		expect(boundary.summary).toHaveBeenCalledTimes(2);
	});
	it("announces each pending phase and prevents premature continuation", async () => {
		const completion = deferred<unknown>(),
			read = deferred<unknown>();
		boundary.complete.mockReturnValue(completion.promise);
		boundary.summary.mockReturnValue(read.promise);
		render(
			<StrictMode>
				<CompletePage />
			</StrictMode>,
		);
		expect(screen.getByRole("status").textContent).toContain("Finalizing");
		expect(screen.getByRole("navigation", { name: "Onboarding progress" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		await act(async () => completion.resolve({ success: true }));
		expect(screen.getByRole("status").textContent).toContain("Loading your setup summary");
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		await act(async () => read.resolve(summary()));
		expect(screen.getByRole("link", { name: "Continue to workspace" })).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledOnce();
	});
	it.each([
		[true, true, false, true, true],
		[true, true, true, true, false],
		[true, false, false, true, false],
		[false, false, undefined, false, false],
	])(
		"retains scoped guidance org=%s admin=%s preset=%s",
		async (hasOrganization, isAdmin, holidayPresetCreated, invite, holiday) => {
			boundary.summary.mockResolvedValue(
				summary({
					hasOrganization,
					isAdmin,
					holidayPresetCreated,
					organizationName: hasOrganization ? "Acme" : undefined,
				}),
			);
			render(<CompletePage />);
			await screen.findByRole("link", { name: "Continue to workspace" });
			expect(!!screen.queryByText("Invite your team members")).toBe(invite);
			expect(!!screen.queryByRole("link", { name: "Set up public holidays" })).toBe(holiday);
			expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
			expect(screen.getByText("Profile completed")).toBeTruthy();
			expect(screen.getByText("Using default notification preferences")).toBeTruthy();
		},
	);
	it("does not finalize for unknown or signed-out sessions", async () => {
		boundary.session = { data: null, isPending: true };
		const view = render(<CompletePage />);
		expect(screen.getByRole("status")).toBeTruthy();
		expect(boundary.complete).not.toHaveBeenCalled();
		boundary.session.isPending = false;
		view.rerender(<CompletePage />);
		expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
		expect(boundary.complete).not.toHaveBeenCalled();
	});
	it("rejects late organization A results across A to B to A without refinalizing", async () => {
		const oldA = deferred<unknown>(),
			b = deferred<unknown>(),
			newA = deferred<unknown>();
		boundary.summary
			.mockReturnValueOnce(oldA.promise)
			.mockReturnValueOnce(b.promise)
			.mockReturnValueOnce(newA.promise);
		const view = render(<CompletePage />);
		await waitFor(() => expect(boundary.summary).toHaveBeenCalledTimes(1));
		boundary.session.data.session.activeOrganizationId = "org-b";
		view.rerender(<CompletePage />);
		await waitFor(() => expect(boundary.summary).toHaveBeenCalledTimes(2));
		boundary.session.data.session.activeOrganizationId = "org-a";
		view.rerender(<CompletePage />);
		await waitFor(() => expect(boundary.summary).toHaveBeenCalledTimes(3));
		await act(async () => {
			oldA.resolve(summary({ organizationName: "Stale A" }));
			b.resolve(summary({ organizationName: "Stale B" }));
		});
		expect(screen.queryByText("Stale A")).toBeNull();
		expect(screen.queryByText("Stale B")).toBeNull();
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		await act(async () => newA.resolve(summary({ organizationName: "Current A", isAdmin: false })));
		expect(screen.getByText("Current A")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Set up public holidays" })).toBeNull();
		expect(boundary.complete).toHaveBeenCalledOnce();
	});
	it("ignores a late completion from a previous account and finalizes the current account once", async () => {
		const previous = deferred<unknown>();
		boundary.complete.mockReturnValueOnce(previous.promise);
		const view = render(<CompletePage />);
		boundary.session.data.user.id = "actor-b";
		view.rerender(<CompletePage />);
		await screen.findByText("Acme");
		await act(async () => previous.resolve({ success: false, error: "stale account" }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(boundary.complete).toHaveBeenCalledTimes(2);
	});
	it("revalidates after cached Activity without reviving old continuation or repeating finalization", async () => {
		const view = render(
			<Activity mode="visible">
				<CompletePage />
			</Activity>,
		);
		await screen.findByRole("link", { name: "Continue to workspace" });
		view.rerender(
			<Activity mode="hidden">
				<CompletePage />
			</Activity>,
		);
		const refresh = deferred<unknown>();
		boundary.summary.mockReturnValueOnce(refresh.promise);
		view.rerender(
			<Activity mode="visible">
				<CompletePage />
			</Activity>,
		);
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		await act(async () =>
			refresh.resolve(summary({ isAdmin: false, organizationName: "Refreshed" })),
		);
		expect(screen.getByText("Refreshed")).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledOnce();
		expect(screen.queryByRole("link", { name: "Set up public holidays" })).toBeNull();
	});
	it("does not read a summary or expose late errors after unmount", async () => {
		const pending = deferred<unknown>();
		boundary.complete.mockReturnValue(pending.promise);
		const view = render(<CompletePage />);
		view.unmount();
		await act(async () => pending.resolve({ success: true }));
		expect(boundary.summary).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("does not revive an old account summary after an A to B to A round trip", async () => {
		const old = deferred<unknown>(),
			fresh = deferred<unknown>();
		boundary.summary
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(summary({ organizationName: "B" }))
			.mockReturnValueOnce(fresh.promise);
		const view = render(<CompletePage />);
		await waitFor(() => expect(boundary.summary).toHaveBeenCalledTimes(1));
		boundary.session.data!.user.id = "actor-b";
		view.rerender(<CompletePage />);
		await screen.findByText("B");
		boundary.session.data!.user.id = "actor-a";
		view.rerender(<CompletePage />);
		await act(async () => old.resolve(summary({ organizationName: "Stale account A" })));
		expect(screen.queryByText("Stale account A")).toBeNull();
		expect(screen.queryByRole("link", { name: "Continue to workspace" })).toBeNull();
		await act(async () => fresh.resolve(summary({ organizationName: "Fresh account A" })));
		expect(screen.getByText("Fresh account A")).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledTimes(2);
	});
	it("keeps rejected finalization retryable and a summary refusal distinct", async () => {
		boundary.complete.mockRejectedValueOnce(new Error("private mutation details"));
		boundary.summary.mockResolvedValueOnce({ success: false, error: "private read details" });
		render(<CompletePage />);
		await screen.findByRole("alert");
		expect(screen.queryByText("private mutation details")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry completion" }));
		await screen.findByRole("button", { name: "Retry summary" });
		expect(screen.queryByText("private read details")).toBeNull();
		expect(screen.getByRole("link", { name: "Continue to workspace" })).toBeTruthy();
		expect(boundary.complete).toHaveBeenCalledTimes(2);
	});
});
