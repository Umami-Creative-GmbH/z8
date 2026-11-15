/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	createWorkTemplateOnboarding: vi.fn(),
	push: vi.fn(),
	skipWorkTemplateSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
			if (!fallback || !values) return fallback ?? _key;
			return Object.entries(values).reduce(
				(result, [key, value]) => result.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));

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
	createWorkTemplateOnboarding: mocks.createWorkTemplateOnboarding,
	skipWorkTemplateSetup: mocks.skipWorkTemplateSetup,
}));

import WorkTemplatesPage from "./page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("WorkTemplatesPage load effect", () => {
	beforeEach(() => {
		mocks.session = {
			data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
			isPending: false,
		};
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.createWorkTemplateOnboarding.mockReset();
		mocks.skipWorkTemplateSetup.mockReset();
	});

	it("keeps a safe heading and no form while checking or routing a non-admin", async () => {
		const check = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(check.promise);
		render(<WorkTemplatesPage />);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Create work schedule template",
		);
		expect(screen.queryByLabelText("Template Name")).toBeNull();
		await act(async () => {
			check.resolve({ success: true, data: false });
		});
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(screen.queryByLabelText("Template Name")).toBeNull();
	});

	it("retains a refused draft with inline feedback and retries the same selected default", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding
			.mockResolvedValueOnce({ success: false, error: "Template could not be saved" })
			.mockResolvedValueOnce({ success: true });
		render(<WorkTemplatesPage />);
		const name = await screen.findByLabelText("Template Name");
		fireEvent.change(name, { target: { value: "Four day" } });
		fireEvent.change(screen.getByLabelText("Hours per Week"), { target: { value: "32.5" } });
		fireEvent.click(screen.getByRole("checkbox", { name: "Fri" }));
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		expect((await screen.findByRole("alert")).textContent).toBe("Template could not be saved");
		expect(name).toHaveProperty("value", "Four day");
		expect(screen.getByText("4 working days, 8.1 hours per day")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
		expect(mocks.createWorkTemplateOnboarding).toHaveBeenLastCalledWith({
			name: "Four day",
			hoursPerWeek: 32.5,
			workingDays: ["monday", "tuesday", "wednesday", "thursday"],
			setAsDefault: false,
		});
	});

	it("does not navigate or announce an abandoned save after organization A→B→A", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		const view = render(<WorkTemplatesPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledOnce());
		mocks.session.data.session.activeOrganizationId = "org-b";
		view.rerender(<WorkTemplatesPage />);
		await screen.findByLabelText("Template Name");
		mocks.session.data.session.activeOrganizationId = "org-a";
		view.rerender(<WorkTemplatesPage />);
		await screen.findByLabelText("Template Name");
		await act(async () => {
			request.resolve({ success: true });
		});
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Save and continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("preserves edited state and submits selected weekdays while loading", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);

		expect(await screen.findByText("5 working days, 8.0 hours per day")).toBeTruthy();
		const weekdayCheckboxes = screen.getAllByRole("checkbox");
		fireEvent.change(screen.getByLabelText("Template Name"), {
			target: { value: "Compressed" },
		});
		fireEvent.change(screen.getByLabelText("Hours per Week"), {
			target: { value: "50" },
		});
		fireEvent.click(weekdayCheckboxes[0]);
		fireEvent.click(weekdayCheckboxes[5]);
		expect(screen.getByText("5 working days, 10.0 hours per day")).toBeTruthy();

		const continueButton = screen.getByRole("button", { name: "Save and continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledWith({
				name: "Compressed",
				hoursPerWeek: 50,
				workingDays: ["tuesday", "wednesday", "thursday", "friday", "saturday"],
				setAsDefault: true,
			});
			expect(continueButton).toHaveProperty("disabled", true);
			expect(screen.getByLabelText("Hours per Week")).toHaveProperty("disabled", true);
		});

		request.resolve({ success: true });
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
	});

	it("keeps invalid template state on screen and blocks submission", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);

		const nameInput = await screen.findByLabelText("Template Name");
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

		expect(await screen.findByText("Template name is required")).toBeTruthy();
		expect(nameInput).toHaveProperty("value", "");
		expect(mocks.createWorkTemplateOnboarding).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalledWith("/onboarding/notifications");
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkTemplateSetup.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Save and continue",
		});
		fireEvent.click(continueButton);
		await waitFor(() => expect(continueButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private creation failure")));

		await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to create work schedule template");
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkTemplateSetup.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to skip work schedule template setup");
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("ignores an admin result that resolves after unmount", async () => {
		const request = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		const { unmount } = render(<WorkTemplatesPage />);
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
		render(<WorkTemplatesPage />);

		await act(async () => {
			request.reject(new Error("private admin failure"));
		});

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"));
	});

	it("keeps a live admin request during StrictMode replay", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });

		render(
			<StrictMode>
				<WorkTemplatesPage />
			</StrictMode>,
		);

		expect(await screen.findByText("Create work schedule template")).toBeTruthy();
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("associates labels and descriptions with every work-template control", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<WorkTemplatesPage />);

		const nameInput = await screen.findByLabelText("Template Name");
		const hoursInput = screen.getByLabelText("Hours per Week");
		const mondayCheckbox = screen.getByRole("checkbox", { name: "Mon" });
		const defaultSwitch = screen.getByLabelText("Set as organization default");

		expect(nameInput.getAttribute("aria-describedby")).toMatch(/description/);
		expect(hoursInput.getAttribute("aria-describedby")).toMatch(/description/);
		expect(mondayCheckbox.getAttribute("aria-checked")).toBe("true");
		expect(defaultSwitch.getAttribute("role")).toBe("switch");
	});

	it("toggles a working day when its day name is clicked", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<WorkTemplatesPage />);

		const saturdayCheckbox = await screen.findByRole("checkbox", { name: "Sat" });
		expect(saturdayCheckbox.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(screen.getByText("Sat"));

		await waitFor(() => expect(saturdayCheckbox.getAttribute("aria-checked")).toBe("true"));
	});

	it("associates a template-name validation error with the invalid input", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<WorkTemplatesPage />);

		const nameInput = await screen.findByLabelText("Template Name");
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);

		const error = await screen.findByRole("alert");
		expect(error.textContent).toBe("Template name is required");
		expect(nameInput.getAttribute("aria-invalid")).toBe("true");
		expect(nameInput.getAttribute("aria-describedby")).toContain(error.id);
	});

	it("blocks native re-entry and skip during a pending save", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledOnce());
		const form = screen.getByLabelText("Template Name").closest("form");
		if (!form) throw new Error("Missing template form");
		fireEvent.submit(form);
		fireEvent.submit(form);
		fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledOnce();
		expect(mocks.skipWorkTemplateSetup).not.toHaveBeenCalled();
		await act(async () => {
			request.resolve({ success: true });
		});
	});

	it("accepts fractional weekly hours typed character by character without replacing the draft", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);
		const user = userEvent.setup();
		const hours = await screen.findByLabelText("Hours per Week");
		await user.clear(hours);
		await user.type(hours, "32.5");
		expect(hours).toHaveProperty("value", "32.5");
		expect(screen.getByText("5 working days, 6.5 hours per day")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() =>
			expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledWith(
				expect.objectContaining({ hoursPerWeek: 32.5 }),
			),
		);
	});

	it("retains a cached Activity draft but refuses its abandoned completion", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		const view = render(
			<Activity mode="visible">
				<WorkTemplatesPage />
			</Activity>,
		);
		fireEvent.change(await screen.findByLabelText("Template Name"), {
			target: { value: "Retained draft" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledOnce());
		view.rerender(
			<Activity mode="hidden">
				<WorkTemplatesPage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<WorkTemplatesPage />
			</Activity>,
		);
		expect(await screen.findByLabelText("Template Name")).toHaveProperty("value", "Retained draft");
		await act(async () => {
			request.resolve({ success: true });
		});
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save and continue" })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it("never dispatches setup work while the account session is being checked", () => {
		mocks.session.isPending = true;
		render(<WorkTemplatesPage />);
		expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Save and continue" })).toBeNull();
		expect(mocks.checkIsAdmin).not.toHaveBeenCalled();
	});

	it("refuses an empty working week even through native submission", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<WorkTemplatesPage />);
		await screen.findByLabelText("Template Name");
		for (const box of screen.getAllByRole("checkbox"))
			if (box.getAttribute("aria-checked") === "true") fireEvent.click(box);
		expect(screen.getByRole("button", { name: "Save and continue" })).toHaveProperty(
			"disabled",
			true,
		);
		const form = screen.getByLabelText("Template Name").closest("form");
		if (!form) throw new Error("Missing template form");
		fireEvent.submit(form);
		await waitFor(() => expect(mocks.createWorkTemplateOnboarding).not.toHaveBeenCalled());
		expect(screen.queryByText("5 working days, 8.0 hours per day")).toBeNull();
	});

	it("does not navigate from a skip after an account change", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkTemplateSetup.mockReturnValue(request.promise);
		const view = render(<WorkTemplatesPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
		await waitFor(() => expect(mocks.skipWorkTemplateSetup).toHaveBeenCalledOnce());
		mocks.session.data.user.id = "actor-b";
		view.rerender(<WorkTemplatesPage />);
		await screen.findByLabelText("Template Name");
		await act(async () => {
			request.resolve({ success: true });
		});
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
