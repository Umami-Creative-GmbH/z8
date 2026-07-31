/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	createWorkTemplateOnboarding: vi.fn(),
	push: vi.fn(),
	skipWorkTemplateSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
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
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.createWorkTemplateOnboarding.mockReset();
		mocks.skipWorkTemplateSetup.mockReset();
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("preserves edited state and submits selected weekdays while loading", async () => {
		const request = deferred<{ success: true }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);

		expect(
			await screen.findByText("5 working days, 8.0 hours per day"),
		).toBeTruthy();
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

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(mocks.createWorkTemplateOnboarding).toHaveBeenCalledWith({
				name: "Compressed",
				hoursPerWeek: 50,
				workingDays: [
					"tuesday",
					"wednesday",
					"thursday",
					"friday",
					"saturday",
				],
				setAsDefault: true,
			});
			expect(continueButton).toHaveProperty("disabled", true);
			expect(screen.getByLabelText("Hours per Week")).toHaveProperty(
				"disabled",
				true,
			);
		});

		request.resolve({ success: true });
		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"),
		);
	});

	it("keeps invalid template state on screen and blocks submission", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockResolvedValue({ success: true });
		render(<WorkTemplatesPage />);

		const nameInput = await screen.findByLabelText("Template Name");
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

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

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createWorkTemplateOnboarding.mockReturnValue(request.promise);
		render(<WorkTemplatesPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () =>
			request.reject(new Error("private creation failure")),
		);

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to create work schedule template",
		);
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
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to skip work schedule template setup",
		);
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

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"),
		);
	});

	it("keeps a live admin request during StrictMode replay", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });

		render(
			<StrictMode>
				<WorkTemplatesPage />
			</StrictMode>,
		);

		expect(
			await screen.findByText("Create work schedule template"),
		).toBeTruthy();
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
});
