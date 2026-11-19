/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { flushSync } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	summary: vi.fn(),
	step: vi.fn(),
	push: vi.fn(),
	session: {
		data: {
			user: { id: "account-a" },
			session: { activeOrganizationId: "org-a" },
		},
		isPending: false,
		refetch: vi.fn(),
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string>) =>
			values ? fallback.replace("{organization}", values.organization) : fallback,
	}),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./actions", () => ({
	startOnboarding: mocks.start,
	getOnboardingSummary: mocks.summary,
	updateOnboardingStep: mocks.step,
}));

import WelcomePage from "./page";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const joined = {
	success: true,
	data: { hasOrganization: true, organizationName: "Acme", isAdmin: false },
};
const ready = () => screen.findByRole("button", { name: "Continue Setup" });

describe("WelcomePage", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.session.data = {
			user: { id: "account-a" },
			session: { activeOrganizationId: "org-a" },
		};
		mocks.session.isPending = false;
		mocks.start.mockResolvedValue({ success: true });
		mocks.summary.mockResolvedValue(joined);
		mocks.step.mockResolvedValue({ success: true });
	});
	it("waits for the summary before offering the correct next step", async () => {
		const held = deferred<typeof joined>();
		mocks.summary.mockReturnValue(held.promise);
		render(<WelcomePage />);
		await waitFor(() => expect(mocks.summary).toHaveBeenCalledOnce());
		expect(screen.queryByRole("button", { name: "Get Started" })).toBeNull();
		expect(mocks.step).not.toHaveBeenCalled();
		await act(async () => held.resolve(joined));
		expect((await ready()).hasAttribute("disabled")).toBe(false);
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByText(/You've joined Acme/)).toBeTruthy();
		expect(screen.getByRole("navigation", { name: "Onboarding progress" })).toBeTruthy();
	});

	it.each(["initialize", "summary"])(
		"retries a refused %s without navigating or repeating successful initialization",
		async (stage) => {
			(stage === "initialize" ? mocks.start : mocks.summary).mockResolvedValueOnce({
				success: false,
				error: "Setup unavailable. Retry.",
			});
			render(<WelcomePage />);
			expect((await screen.findByRole("alert")).textContent).toContain("Setup unavailable. Retry.");
			expect(mocks.push).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
			await ready();
			expect(mocks.start).toHaveBeenCalledTimes(stage === "initialize" ? 2 : 1);
			expect(mocks.summary).toHaveBeenCalledTimes(stage === "initialize" ? 1 : 2);
		},
	);

	it.each([true, false])(
		"saves the original destination after successful continuation (hasOrganization=%s)",
		async (hasOrganization) => {
			mocks.summary.mockResolvedValue({
				success: true,
				data: { hasOrganization, isAdmin: false, organizationName: null },
			});
			const held = deferred<{ success: boolean }>();
			mocks.step.mockReturnValue(held.promise);
			render(<WelcomePage />);
			const button = await screen.findByRole("button", {
				name: hasOrganization ? "Continue Setup" : "Get Started",
			});
			act(() => {
				fireEvent.click(button);
				fireEvent.click(button);
			});
			expect(mocks.step).toHaveBeenCalledExactlyOnceWith(
				hasOrganization ? "profile" : "organization",
			);
			expect(button.hasAttribute("disabled")).toBe(true);
			expect(mocks.push).not.toHaveBeenCalled();
			await act(async () => held.resolve({ success: true }));
			expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
				hasOrganization ? "/onboarding/profile" : "/onboarding/organization",
			);
		},
	);

	it.each(["refused", "rejected"])(
		"retains retryable continuation after %s step update",
		async (kind) => {
			if (kind === "refused")
				mocks.step.mockResolvedValueOnce({
					success: false,
					error: "Permission changed",
				});
			else mocks.step.mockRejectedValueOnce(new Error("private transport details"));
			render(<WelcomePage />);
			fireEvent.click(await ready());
			expect(await screen.findByRole("alert")).toBeTruthy();
			expect(screen.queryByText("private transport details")).toBeNull();
			expect(mocks.push).not.toHaveBeenCalled();
			fireEvent.click(await ready());
			await waitFor(() =>
				expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/onboarding/profile"),
			);
		},
	);

	it("starts once during StrictMode replay", async () => {
		render(
			<StrictMode>
				<WelcomePage />
			</StrictMode>,
		);
		await ready();
		expect(mocks.start).toHaveBeenCalledOnce();
		expect(mocks.summary).toHaveBeenCalledOnce();
	});

	it("waits for a session and offers recovery without starting for an unavailable account", async () => {
		mocks.session.data.user.id = "";
		mocks.session.isPending = true;
		const view = render(<WelcomePage />);
		expect(screen.getByRole("status").textContent).toContain("Waiting for your session");
		expect(mocks.start).not.toHaveBeenCalled();
		mocks.session.isPending = false;
		view.rerender(<WelcomePage />);
		fireEvent.click(screen.getByRole("button", { name: "Retry session" }));
		expect(mocks.session.refetch).toHaveBeenCalledOnce();
		expect(mocks.start).not.toHaveBeenCalled();
	});

	it.each(["initialize", "summary"])(
		"recovers a rejected %s without disclosing transport details",
		async (stage) => {
			(stage === "initialize" ? mocks.start : mocks.summary).mockRejectedValueOnce(
				new Error("private diagnostics"),
			);
			render(<WelcomePage />);
			expect((await screen.findByRole("alert")).textContent).toContain(
				"Setup could not be prepared",
			);
			expect(screen.queryByText("private diagnostics")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
			await ready();
		},
	);

	it.each([true, false])(
		"retains role-derived progress and all guidance for admin=%s",
		async (isAdmin) => {
			mocks.summary.mockResolvedValue({
				...joined,
				data: { ...joined.data, isAdmin },
			});
			render(<WelcomePage />);
			await ready();
			expect(screen.getByRole("heading", { name: "Time Tracking" })).toBeTruthy();
			expect(screen.getByRole("heading", { name: "Absence Management" })).toBeTruthy();
			expect(screen.getByRole("heading", { name: "Team Collaboration" })).toBeTruthy();
			expect(Boolean(screen.queryByText("Vacation"))).toBe(isAdmin);
		},
	);

	describe.each(["account", "organization"])("%s-only scope lifetime", (scope) => {
		it.each(
			["initialize", "summary", "step"].flatMap((stage) =>
				["rejected", "refused", "success"].map((outcome) => ({
					stage,
					outcome,
				})),
			),
		)("ignores a held $outcome $stage after A→B→A", async ({ stage, outcome }) => {
			const held = deferred<unknown>();
			(stage === "initialize"
				? mocks.start
				: stage === "summary"
					? mocks.summary
					: mocks.step
			).mockReturnValueOnce(held.promise);
			const view = render(<WelcomePage />);
			if (stage === "step") fireEvent.click(await ready());
			await waitFor(() =>
				expect(
					stage === "initialize" ? mocks.start : stage === "summary" ? mocks.summary : mocks.step,
				).toHaveBeenCalledOnce(),
			);
			if (scope === "account") mocks.session.data.user.id = "account-b";
			else mocks.session.data.session.activeOrganizationId = "org-b";
			view.rerender(<WelcomePage />);
			await ready();
			if (scope === "account") mocks.session.data.user.id = "account-a";
			else mocks.session.data.session.activeOrganizationId = "org-a";
			view.rerender(<WelcomePage />);
			await ready();
			await act(async () => {
				if (outcome === "rejected") held.reject(new Error("Obsolete rejected operation"));
				else if (outcome === "refused") held.resolve({ success: false, error: "Obsolete refusal" });
				else
					held.resolve({
						...joined,
						data: { ...joined.data, organizationName: "Obsolete success" },
					});
			});
			expect(screen.queryByText(/Obsolete success/)).toBeNull();
			expect(screen.queryByRole("alert")).toBeNull();
			expect(mocks.push).not.toHaveBeenCalled();
			fireEvent.click(await ready());
			await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
		});
	});

	it("revalidates a cached Activity summary before enabling another continuation", async () => {
		const held = deferred<typeof joined>();
		mocks.summary.mockResolvedValueOnce(joined).mockReturnValueOnce(held.promise);
		const view = render(
			<Activity mode="visible">
				<WelcomePage />
			</Activity>,
		);
		await ready();
		view.rerender(
			<Activity mode="hidden">
				<WelcomePage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<WelcomePage />
			</Activity>,
		);
		await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(2));
		expect(screen.queryByRole("button", { name: "Continue Setup" })).toBeNull();
		await act(async () => held.resolve(joined));
		fireEvent.click(await ready());
		await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
	});

	it.each(["initialize", "summary"])(
		"does not continue a hidden Activity's obsolete %s",
		async (stage) => {
			const held = deferred<typeof joined>();
			(stage === "initialize" ? mocks.start : mocks.summary).mockReturnValueOnce(held.promise);
			const view = render(
				<Activity mode="visible">
					<WelcomePage />
				</Activity>,
			);
			await waitFor(() =>
				expect(stage === "initialize" ? mocks.start : mocks.summary).toHaveBeenCalledOnce(),
			);
			view.rerender(
				<Activity mode="hidden">
					<WelcomePage />
				</Activity>,
			);
			await act(async () =>
				held.resolve({
					...joined,
					data: { ...joined.data, organizationName: "Obsolete Activity" },
				}),
			);
			if (stage === "initialize") expect(mocks.summary).not.toHaveBeenCalled();
			view.rerender(
				<Activity mode="visible">
					<WelcomePage />
				</Activity>,
			);
			await ready();
			expect(screen.queryByText(/Obsolete Activity/)).toBeNull();
			expect(mocks.push).not.toHaveBeenCalled();
		},
	);

	it.each(["initialize", "summary", "step"])(
		"ignores held %s across account and organization A→B→A",
		async (stage) => {
			const held = deferred<typeof joined>();
			(stage === "initialize"
				? mocks.start
				: stage === "summary"
					? mocks.summary
					: mocks.step
			).mockReturnValueOnce(held.promise);
			const view = render(<WelcomePage />);
			if (stage === "step") fireEvent.click(await ready());
			await waitFor(() =>
				expect(
					stage === "initialize" ? mocks.start : stage === "summary" ? mocks.summary : mocks.step,
				).toHaveBeenCalledOnce(),
			);
			mocks.session.data = {
				user: { id: "account-b" },
				session: { activeOrganizationId: "org-b" },
			};
			view.rerender(<WelcomePage />);
			await ready();
			mocks.session.data = {
				user: { id: "account-a" },
				session: { activeOrganizationId: "org-a" },
			};
			view.rerender(<WelcomePage />);
			await ready();
			await act(async () =>
				held.resolve({
					...joined,
					data: { ...joined.data, organizationName: "Obsolete company" },
				}),
			);
			expect(screen.queryByText(/Obsolete company/)).toBeNull();
			expect(mocks.push).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);

	it.each(["initialize", "summary", "step"])(
		"ignores held %s refusal after unmount",
		async (stage) => {
			const held = deferred<{ success: false; error: string }>();
			(stage === "initialize"
				? mocks.start
				: stage === "summary"
					? mocks.summary
					: mocks.step
			).mockReturnValueOnce(held.promise);
			const view = render(<WelcomePage />);
			if (stage === "step") fireEvent.click(await ready());
			await waitFor(() =>
				expect(
					stage === "initialize" ? mocks.start : stage === "summary" ? mocks.summary : mocks.step,
				).toHaveBeenCalledOnce(),
			);
			view.unmount();
			await act(async () => held.resolve({ success: false, error: "Obsolete refusal" }));
			expect(mocks.push).not.toHaveBeenCalled();
			if (stage === "initialize") expect(mocks.summary).not.toHaveBeenCalled();
		},
	);

	it("retires continuation while the session is pending even with retained identity", async () => {
		const view = render(<WelcomePage />);
		const previousAction = await ready();
		mocks.session.isPending = true;
		flushSync(() => view.rerender(<WelcomePage />));
		fireEvent.click(previousAction);
		await act(async () => Promise.resolve());
		expect(mocks.step).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Continue Setup" })).toBeNull();
		expect(screen.getByRole("status").textContent).toContain("Waiting for your session");
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		mocks.session.isPending = false;
		view.rerender(<WelcomePage />);
		fireEvent.click(await ready());
		await waitFor(() => expect(mocks.step).toHaveBeenCalledExactlyOnceWith("profile"));
		expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/onboarding/profile");
	});

	it("requires a fresh summary before continuing immediately after Activity returns", async () => {
		const noOrganization = {
			success: true,
			data: { hasOrganization: false, organizationName: null, isAdmin: false },
		};
		const held = deferred<typeof noOrganization>();
		mocks.summary.mockResolvedValueOnce(joined).mockReturnValueOnce(held.promise);
		const content = (mode: "hidden" | "visible") => (
			<Activity mode={mode}>
				<WelcomePage />
			</Activity>
		);
		const view = render(content("visible"));
		await ready();
		act(() => {
			flushSync(() => view.rerender(content("hidden")));
			flushSync(() => view.rerender(content("visible")));
			const previousAction = screen.queryByRole("button", { name: "Continue Setup" });
			if (previousAction) fireEvent.click(previousAction);
		});
		await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(2));
		expect(mocks.step).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
		await act(async () => held.resolve(noOrganization));
		fireEvent.click(await screen.findByRole("button", { name: "Get Started" }));
		await waitFor(() => expect(mocks.step).toHaveBeenCalledExactlyOnceWith("organization"));
		expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/onboarding/organization");
	});

	it("suppresses a hidden Activity's late step success and permits a fresh continuation on return", async () => {
		const held = deferred<{ success: true }>();
		mocks.step.mockReturnValueOnce(held.promise);
		const view = render(
			<Activity mode="visible">
				<WelcomePage />
			</Activity>,
		);
		fireEvent.click(await ready());
		view.rerender(
			<Activity mode="hidden">
				<WelcomePage />
			</Activity>,
		);
		await act(async () => held.resolve({ success: true }));
		expect(mocks.push).not.toHaveBeenCalled();
		view.rerender(
			<Activity mode="visible">
				<WelcomePage />
			</Activity>,
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Continue Setup" }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		fireEvent.click(await ready());
		await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
	});
});
