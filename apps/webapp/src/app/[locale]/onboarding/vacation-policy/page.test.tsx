/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	session: { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } },
	pending: false,
	listeners: new Set<(value: unknown) => void>(),
	checkIsAdmin: vi.fn(),
	createVacationPolicyOnboarding: vi.fn(),
	push: vi.fn(),
	skipVacationPolicySetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: mocks.session, isPending: mocks.pending }),
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({ data: mocks.session }),
					subscribe: (listener: (value: unknown) => void) => {
						mocks.listeners.add(listener);
						return () => mocks.listeners.delete(listener);
					},
				},
			},
		},
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	checkIsAdmin: mocks.checkIsAdmin,
	createVacationPolicyOnboarding: mocks.createVacationPolicyOnboarding,
	skipVacationPolicySetup: mocks.skipVacationPolicySetup,
}));

import VacationPolicyPage from "./page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("VacationPolicyPage load effect", () => {
	beforeEach(() => {
		mocks.session = { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } };
		mocks.pending = false;
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.createVacationPolicyOnboarding.mockReset();
		mocks.skipVacationPolicySetup.mockReset();
	});

	it.each(["pending-session", "held-access"])(
		"keeps one task heading and no policy controls during %s",
		async (boundary) => {
			mocks.pending = boundary === "pending-session";
			mocks.checkIsAdmin.mockReturnValue(new Promise(() => {}));
			render(
				<main>
					<VacationPolicyPage />
				</main>,
			);
			await act(async () => {});
			const main = within(screen.getByRole("main"));
			expect(main.getAllByRole("heading", { level: 1 })).toHaveLength(1);
			expect(main.getByRole("heading", { level: 1 }).textContent).toBe("Set up vacation policy");
			expect(main.queryByLabelText("Policy Name")).toBeNull();
			expect(main.queryByRole("button", { name: "Save and continue" })).toBeNull();
		},
	);

	it("retires held saves through an organization A to B to A arrival", async () => {
		const held = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(held.promise);
		const view = render(<VacationPolicyPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.createVacationPolicyOnboarding).toHaveBeenCalledOnce());
		mocks.session = { ...mocks.session, session: { activeOrganizationId: "org-b" } };
		view.rerender(<VacationPolicyPage />);
		await screen.findByLabelText("Policy Name");
		mocks.session = { ...mocks.session, session: { activeOrganizationId: "org-a" } };
		view.rerender(<VacationPolicyPage />);
		const draft = await screen.findByLabelText("Policy Name");
		fireEvent.change(draft, { target: { value: "New arrival" } });
		await act(async () => held.resolve({ success: true }));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(draft).toHaveProperty("value", "New arrival");
	});

	it.each([
		["save", "account", true],
		["save", "account", false],
		["save", "organization", true],
		["save", "organization", false],
		["skip", "account", true],
		["skip", "account", false],
		["skip", "organization", true],
		["skip", "organization", false],
	] as const)(
		"retires held %s after batched %s A→B→A (success=%s)",
		async (action, scope, success) => {
			const held = deferred<{ success: boolean; error?: string }>();
			mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
			const operation =
				action === "save" ? mocks.createVacationPolicyOnboarding : mocks.skipVacationPolicySetup;
			operation.mockReturnValue(held.promise);
			render(<VacationPolicyPage />);
			fireEvent.click(
				await screen.findByRole("button", {
					name: action === "save" ? "Save and continue" : "Skip for now",
				}),
			);
			await waitFor(() => expect(operation).toHaveBeenCalledOnce());
			await act(async () => {
				for (const suffix of ["b", "a"]) {
					mocks.session =
						scope === "account"
							? { ...mocks.session, user: { id: `account-${suffix}` } }
							: { ...mocks.session, session: { activeOrganizationId: `org-${suffix}` } };
					for (const listener of mocks.listeners) listener({ data: mocks.session });
				}
			});
			const draft = await screen.findByLabelText("Policy Name");
			fireEvent.change(draft, { target: { value: "Current arrival draft" } });
			await act(async () => held.resolve({ success, error: "Retired refusal" }));
			expect(mocks.push).not.toHaveBeenCalled();
			expect(mocks.toastError).not.toHaveBeenCalled();
			expect(mocks.toastSuccess).not.toHaveBeenCalled();
			expect(draft).toHaveProperty("value", "Current arrival draft");
		},
	);

	it.each(["account", "organization"] as const)(
		"retires held access through batched %s A→B→A",
		async (scope) => {
			const held = deferred<{ success: true; data: false }>();
			mocks.checkIsAdmin
				.mockReturnValueOnce(held.promise)
				.mockResolvedValue({ success: true, data: true });
			render(<VacationPolicyPage />);
			await act(async () => {
				for (const suffix of ["b", "a"]) {
					mocks.session =
						scope === "account"
							? { ...mocks.session, user: { id: `account-${suffix}` } }
							: { ...mocks.session, session: { activeOrganizationId: `org-${suffix}` } };
					for (const listener of mocks.listeners) listener({ data: mocks.session });
				}
			});
			await screen.findByLabelText("Policy Name");
			await act(async () => held.resolve({ success: true, data: false }));
			expect(mocks.push).not.toHaveBeenCalled();
		},
	);

	it("observes batched account A to B to A changes before a held skip refusal", async () => {
		const held = deferred<{ success: false; error: string }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockReturnValue(held.promise);
		render(<VacationPolicyPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
		await act(async () => {
			for (const id of ["account-b", "account-a"]) {
				mocks.session = { ...mocks.session, user: { id } };
				for (const listener of mocks.listeners) listener({ data: mocks.session });
			}
			held.resolve({ success: false, error: "Old refusal" });
		});
		expect(await screen.findByLabelText("Policy Name")).toHaveProperty("value", "Standard");
		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("does not admit or redirect from a retired access read", async () => {
		const held = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin
			.mockReturnValueOnce(held.promise)
			.mockResolvedValue({ success: true, data: true });
		const view = render(<VacationPolicyPage />);
		expect(screen.queryByLabelText("Policy Name")).toBeNull();
		mocks.session = { ...mocks.session, session: { activeOrganizationId: "org-b" } };
		view.rerender(<VacationPolicyPage />);
		await screen.findByLabelText("Policy Name");
		await act(async () => held.resolve({ success: true, data: false }));
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("retains a draft after save refusal and permits an intentional retry", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding
			.mockResolvedValueOnce({ success: false, error: "Save refused" })
			.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);
		const name = await screen.findByLabelText("Policy Name");
		fireEvent.change(name, { target: { value: "Retained policy" } });
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Save refused"));
		expect(name).toHaveProperty("value", "Retained policy");
		expect(mocks.push).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"));
		expect(mocks.createVacationPolicyOnboarding).toHaveBeenCalledTimes(2);
	});

	it("retains skip refusal instead of forcing continuation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockResolvedValue({ success: false, error: "Skip refused" });
		render(<VacationPolicyPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Skip refused"));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save and continue" })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it("guards duplicate native submissions and skip clicks during a save", async () => {
		const held = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(held.promise);
		render(<VacationPolicyPage />);
		const name = await screen.findByLabelText("Policy Name");
		const form = name.closest("form")!;
		fireEvent.submit(form);
		fireEvent.submit(form);
		fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		await waitFor(() => expect(mocks.createVacationPolicyOnboarding).toHaveBeenCalledOnce());
		expect(mocks.skipVacationPolicySetup).not.toHaveBeenCalled();
		await act(async () => held.resolve({ success: true }));
	});

	it("retires a save while cached Activity is hidden, then rechecks access", async () => {
		const held = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(held.promise);
		const view = render(
			<Activity mode="visible">
				<VacationPolicyPage />
			</Activity>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.createVacationPolicyOnboarding).toHaveBeenCalledOnce());
		view.rerender(
			<Activity mode="hidden">
				<VacationPolicyPage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<VacationPolicyPage />
			</Activity>,
		);
		await screen.findByLabelText("Policy Name");
		await act(async () => held.resolve({ success: true }));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
	});

	it("routes a non-admin to notifications without exposing policy controls", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		render(<VacationPolicyPage />);
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(screen.queryByLabelText("Policy Name")).toBeNull();
	});

	it("associates day validation with the input and names each policy decision", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<VacationPolicyPage />);
		const days = await screen.findByLabelText("Annual Vacation Days");
		fireEvent.change(days, { target: { value: "400" } });
		const error = await screen.findByRole("alert");
		expect(days.getAttribute("aria-describedby")).toContain(error.id);
		expect(days.getAttribute("aria-invalid")).toBe("true");
		for (const name of [
			"Policy and annual allowance",
			"When days are granted",
			"Unused days at year end",
		])
			expect(screen.getByRole("group", { name })).toBeTruthy();
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Save and continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("preserves carryover state and submits the policy while loading", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		const carryoverSwitch = await screen.findByRole("switch");
		const carryoverInput = screen.getByPlaceholderText("5");
		fireEvent.change(carryoverInput, { target: { value: "7" } });
		fireEvent.click(carryoverSwitch);
		await waitFor(() => expect(screen.queryByPlaceholderText("5")).toBeNull());
		fireEvent.click(carryoverSwitch);
		await waitFor(() => expect(screen.getByPlaceholderText("5")).toHaveProperty("value", "7"));

		const continueButton = screen.getByRole("button", { name: "Save and continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(mocks.createVacationPolicyOnboarding).toHaveBeenCalledWith({
				name: "Standard",
				defaultAnnualDays: 25,
				accrualType: "annual",
				allowCarryover: true,
				maxCarryoverDays: 7,
			});
			expect(continueButton).toHaveProperty("disabled", true);
			expect(carryoverSwitch).toHaveProperty("disabled", true);
		});

		request.resolve({ success: true });
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"));
	});

	it("keeps invalid policy state on screen and blocks submission", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);

		const nameInput = await screen.findByPlaceholderText("e.g., Standard, Senior");
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

		expect(await screen.findByText("Policy name is required")).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(nameInput));
		expect(nameInput).toHaveProperty("value", "");
		expect(mocks.createVacationPolicyOnboarding).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalledWith("/onboarding/work-templates");
	});

	it("associates policy fields with their visible labels", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<VacationPolicyPage />);

		expect(await screen.findByLabelText("Policy Name")).toBeTruthy();
		expect(screen.getByLabelText("Annual Vacation Days")).toBeTruthy();
		expect(screen.getByLabelText("Accrual Type")).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Allow Carryover" })).toBeTruthy();
		expect(screen.getByLabelText("Max Carryover Days")).toBeTruthy();
	});

	it("shows a readable message when the day count is out of range", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<VacationPolicyPage />);

		const annualDays = await screen.findByLabelText("Annual Vacation Days");
		fireEvent.change(annualDays, { target: { value: "400" } });

		expect(await screen.findByText("Days cannot exceed 365")).toBeTruthy();
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Save and continue",
		});
		fireEvent.click(continueButton);
		await waitFor(() => expect(continueButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private creation failure")));

		await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to create vacation policy");
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to skip vacation policy setup");
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("ignores an admin result that resolves after unmount", async () => {
		const request = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		const { unmount } = render(<VacationPolicyPage />);
		await waitFor(() => expect(mocks.checkIsAdmin).toHaveBeenCalledOnce());

		unmount();
		await act(async () => {
			request.resolve({ success: true, data: false });
			await request.promise;
		});

		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("uses the safe fallback route when the admin check rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		await act(async () => {
			request.reject(new Error("private admin failure"));
		});

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
	});

	it("keeps a live admin request during StrictMode replay", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });

		render(
			<StrictMode>
				<VacationPolicyPage />
			</StrictMode>,
		);

		expect(await screen.findByText("Set up vacation policy")).toBeTruthy();
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("ignores an admin check that resolves after unmount", async () => {
		let resolveAdminCheck: (value: { success: true; data: false }) => void = () => undefined;
		mocks.checkIsAdmin.mockReturnValue(
			new Promise((resolve) => {
				resolveAdminCheck = resolve;
			}),
		);

		const { unmount } = render(<VacationPolicyPage />);
		unmount();
		resolveAdminCheck({ success: true, data: false });

		await Promise.resolve();
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
